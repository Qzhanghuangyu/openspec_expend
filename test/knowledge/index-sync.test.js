import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { buildKnowledgeIndex } from '../../src/knowledge/index/build.js';
import { INDEX_CONFIG_PATH, defaultIndexConfig } from '../../src/knowledge/index/config.js';
import { INDEX_FILES, INDEX_ROOT } from '../../src/knowledge/index/contract.js';
import { syncKnowledgeIndex } from '../../src/knowledge/index/sync.js';

const SOURCE = 'app/src/main/java/Demo.kt';

function entry(id, body, aliases = []) {
  const data = {
    'schema-version': 1, id, kind: 'component', scope: 'project', status: 'draft',
    platform: 'android-view', aliases, intents: ['测试增量索引'], tags: ['test'],
    codegraph: { 'primary-symbol': 'Demo', 'related-symbols': [] },
    'source-files': [SOURCE], 'layout-resources': [], tests: [],
    'source-hashes': {}, 'last-verified': null, 'verified-by': '',
  };
  return `---\n${YAML.stringify(data)}---\n# ${id}\n\n## 适用场景\n\n${body}\n`;
}

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-index-sync-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'openspec'));
  await mkdir(path.join(root, '.falla/ui-knowledge/components'), { recursive: true });
  await mkdir(path.join(root, path.dirname(SOURCE)), { recursive: true });
  await writeFile(path.join(root, SOURCE), 'class Demo\n');
  const config = defaultIndexConfig();
  config.semantic = { ...config.semantic, provider: 'fake', model: 'fake-v1', dimensions: 16 };
  await writeFile(path.join(root, INDEX_CONFIG_PATH), YAML.stringify(config));
  await writeFile(path.join(root, '.falla/ui-knowledge/components/alpha.md'), entry('alpha', 'Alpha'));
  await buildKnowledgeIndex(root, { now: () => new Date('2026-09-20T00:00:00.000Z') });
  return root;
}

async function snapshot(root) {
  const base = path.join(root, INDEX_ROOT);
  return {
    manifest: JSON.parse(await readFile(path.join(base, INDEX_FILES.manifest), 'utf8')),
    chunks: ((await readFile(path.join(base, INDEX_FILES.chunks), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)),
    vectors: JSON.parse(await readFile(path.join(base, INDEX_FILES.vectors), 'utf8')),
  };
}

test('sync 只嵌入新增和修改文档，并保留未变化向量', async (t) => {
  const root = await fixture(t);
  const before = await snapshot(root);
  const alphaVector = before.vectors.vectors.find(item => item.chunkId === 'component:alpha#metadata');
  await writeFile(path.join(root, '.falla/ui-knowledge/components/beta.md'), entry('beta', 'Beta'));
  let report = await syncKnowledgeIndex(root, { now: () => new Date('2026-09-20T01:00:00.000Z') });
  assert.deepEqual(report.added, ['beta']);
  assert.deepEqual(report.updated, []);
  assert.equal(report.embeddedChunks, 3);

  let after = await snapshot(root);
  assert.deepEqual(
    after.vectors.vectors.find(item => item.chunkId === 'component:alpha#metadata'),
    alphaVector
  );

  await writeFile(
    path.join(root, '.falla/ui-knowledge/components/beta.md'),
    entry('beta', 'Beta changed', ['changed'])
  );
  report = await syncKnowledgeIndex(root, { now: () => new Date('2026-09-20T02:00:00.000Z') });
  assert.deepEqual(report.updated, ['beta']);
  assert.equal(report.embeddedChunks, 3);
  after = await snapshot(root);
  assert.equal(after.manifest.generatedAt, '2026-09-20T02:00:00.000Z');
});

test('无变化 sync 不写索引且 embedding 调用量为零', async (t) => {
  const root = await fixture(t);
  const before = await readFile(path.join(root, INDEX_ROOT, INDEX_FILES.manifest), 'utf8');
  const report = await syncKnowledgeIndex(root);
  const after = await readFile(path.join(root, INDEX_ROOT, INDEX_FILES.manifest), 'utf8');
  assert.equal(report.changed, false);
  assert.equal(report.embeddedChunks, 0);
  assert.deepEqual(report.unchanged, ['alpha']);
  assert.equal(after, before);
});

test('删除或变为非法的文档会从索引移除', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, '.falla/ui-knowledge/components/alpha.md'));
  const report = await syncKnowledgeIndex(root);
  assert.deepEqual(report.removed, ['alpha']);
  const after = await snapshot(root);
  assert.equal(after.manifest.counts.documents, 0);
  assert.equal(after.chunks.length, 0);
  assert.equal(after.vectors.vectors.length, 0);
});

test('Provider 或维度变化要求 rebuild，不覆盖旧索引', async (t) => {
  const root = await fixture(t);
  const config = defaultIndexConfig();
  config.semantic = { ...config.semantic, provider: 'fake', model: 'fake-v2', dimensions: 24 };
  await writeFile(path.join(root, INDEX_CONFIG_PATH), YAML.stringify(config));
  const before = await readFile(path.join(root, INDEX_ROOT, INDEX_FILES.manifest), 'utf8');
  await assert.rejects(syncKnowledgeIndex(root), error => error.details?.kind === 'index-rebuild-required');
  assert.equal(await readFile(path.join(root, INDEX_ROOT, INDEX_FILES.manifest), 'utf8'), before);
});

test('CLI sync 返回增量报告', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, '.falla/ui-knowledge/components/beta.md'), entry('beta', 'Beta'));
  let output = '';
  const io = { cwd: root, env: {}, stdout: { write: value => { output += value; } } };
  const { main } = await import('../../src/cli.js');
  assert.equal(await main(['ui-knowledge', 'index', 'sync', '--json'], io), 0);
  const report = JSON.parse(output);
  assert.deepEqual(report.added, ['beta']);
  assert.equal(report.embeddedChunks, 3);
});
