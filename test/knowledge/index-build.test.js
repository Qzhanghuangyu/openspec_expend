import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { main } from '../../src/cli.js';
import { buildKnowledgeIndex, statusKnowledgeIndex } from '../../src/knowledge/index/build.js';
import { INDEX_CONFIG_PATH, defaultIndexConfig } from '../../src/knowledge/index/config.js';
import { INDEX_FILES, INDEX_ROOT } from '../../src/knowledge/index/contract.js';

const ENTRY = '.falla/ui-knowledge/components/demo-view.md';
const SOURCE = 'app/src/main/java/DemoView.kt';

function metadata(overrides = {}) {
  return {
    'schema-version': 1,
    id: 'demo-view',
    kind: 'component',
    scope: 'project',
    status: 'draft',
    platform: 'android-view',
    aliases: ['演示组件'],
    intents: ['构建测试索引'],
    tags: ['test'],
    codegraph: { 'primary-symbol': 'DemoView', 'related-symbols': [] },
    'source-files': [SOURCE],
    'layout-resources': [],
    tests: [],
    'source-hashes': {},
    'last-verified': null,
    'verified-by': '',
    ...overrides,
  };
}

async function fixture(t, { configured = true } = {}) {
  const root = await mkdtemp('/private/tmp/falla-index-build-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'openspec'));
  await mkdir(path.join(root, path.dirname(ENTRY)), { recursive: true });
  await mkdir(path.join(root, path.dirname(SOURCE)), { recursive: true });
  await writeFile(path.join(root, SOURCE), 'class DemoView\n');
  await writeFile(
    path.join(root, ENTRY),
    `---\n${YAML.stringify(metadata())}---\n# DemoView\n\n## 适用场景\n\n用于构建测试。\n\n## 风险与限制\n\n仅供测试。\n`
  );
  if (configured) {
    const config = defaultIndexConfig();
    config.semantic = {
      ...config.semantic,
      provider: 'fake',
      model: 'fake-v1',
      dimensions: 16,
    };
    await writeFile(path.join(root, INDEX_CONFIG_PATH), YAML.stringify(config));
  }
  return root;
}

function indexFile(root, name) {
  return path.join(root, INDEX_ROOT, name);
}

test('Fake Provider 首次 build 原子写入 Manifest、chunks 和 vectors', async (t) => {
  const root = await fixture(t);
  const report = await buildKnowledgeIndex(root, { now: () => new Date('2026-09-20T00:00:00.000Z') });
  assert.deepEqual(report, {
    ok: true,
    action: 'build',
    indexPath: INDEX_ROOT,
    provider: 'fake',
    model: 'fake-v1',
    dimensions: 16,
    documents: 1,
    chunks: 4,
    rejected: 0,
  });

  const manifest = JSON.parse(await readFile(indexFile(root, INDEX_FILES.manifest), 'utf8'));
  const chunks = (await readFile(indexFile(root, INDEX_FILES.chunks), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  const vectors = JSON.parse(await readFile(indexFile(root, INDEX_FILES.vectors), 'utf8'));
  assert.equal(manifest.generatedAt, '2026-09-20T00:00:00.000Z');
  assert.equal(Object.keys(manifest.documents).length, 1);
  assert.equal(chunks.length, manifest.counts.chunks);
  assert.equal(vectors.vectors.length, chunks.length);
  assert.ok(vectors.vectors.every(item => item.values.length === 16));
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(await statusKnowledgeIndex(root), {
    ok: true,
    action: 'status',
    exists: true,
    indexPath: INDEX_ROOT,
    formatVersion: 1,
    generatedAt: '2026-09-20T00:00:00.000Z',
    provider: 'fake',
    model: 'fake-v1',
    dimensions: 16,
    documents: 1,
    chunks: 4,
    rejected: 0,
  });
});

test('build 拒绝覆盖已有索引且未配置 Provider 时不创建目录', async (t) => {
  const root = await fixture(t);
  await buildKnowledgeIndex(root);
  await assert.rejects(buildKnowledgeIndex(root), error => error.details?.kind === 'index-already-exists');

  const unconfigured = await fixture(t, { configured: false });
  await assert.rejects(buildKnowledgeIndex(unconfigured), /尚未配置可用的 Embedding Provider/);
  await assert.rejects(access(path.join(unconfigured, INDEX_ROOT)), { code: 'ENOENT' });
});

test('CLI build 与 status 使用稳定 JSON 输出', async (t) => {
  const root = await fixture(t);
  let output = '';
  const io = { cwd: root, env: {}, stdout: { write: value => { output += value; } } };
  assert.equal(await main(['ui-knowledge', 'index', 'build', '--json'], io), 0);
  assert.equal(JSON.parse(output).action, 'build');
  output = '';
  assert.equal(await main(['ui-knowledge', 'index', 'status', '--json'], io), 0);
  assert.equal(JSON.parse(output).exists, true);
});

test('status 在索引不存在时只读返回 exists=false', async (t) => {
  const root = await fixture(t, { configured: false });
  assert.deepEqual(await statusKnowledgeIndex(root), {
    ok: true,
    action: 'status',
    exists: false,
    indexPath: INDEX_ROOT,
  });
});
