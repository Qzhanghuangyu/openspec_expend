import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { main } from '../../src/cli.js';
import {
  buildKnowledgeIndex,
  clearKnowledgeIndex,
  rebuildKnowledgeIndex,
  statusKnowledgeIndex,
} from '../../src/knowledge/index/build.js';
import { INDEX_CONFIG_PATH, defaultIndexConfig } from '../../src/knowledge/index/config.js';
import { INDEX_FILES, INDEX_ROOT } from '../../src/knowledge/index/contract.js';

const ENTRY = '.falla/ui-knowledge/components/demo.md';
const SOURCE = 'app/src/main/java/Demo.kt';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-index-lifecycle-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'openspec'));
  await mkdir(path.join(root, path.dirname(ENTRY)), { recursive: true });
  await mkdir(path.join(root, path.dirname(SOURCE)), { recursive: true });
  await writeFile(path.join(root, SOURCE), 'class Demo\n');
  const data = {
    'schema-version': 1, id: 'demo', kind: 'component', scope: 'project',
    status: 'draft', platform: 'android-view', aliases: [], intents: ['demo'], tags: [],
    codegraph: { 'primary-symbol': 'Demo', 'related-symbols': [] },
    'source-files': [SOURCE], 'layout-resources': [], tests: [],
    'source-hashes': {}, 'last-verified': null, 'verified-by': '',
  };
  await writeFile(path.join(root, ENTRY), `---\n${YAML.stringify(data)}---\n# Demo\n\n## Usage\n\nDemo\n`);
  await writeConfig(root, 'fake-v1', 16);
  return root;
}

async function writeConfig(root, model, dimensions) {
  const config = defaultIndexConfig();
  config.semantic = { ...config.semantic, provider: 'fake', model, dimensions };
  await writeFile(path.join(root, INDEX_CONFIG_PATH), YAML.stringify(config));
}

test('rebuild 原子替换旧索引并允许 Provider 配置变化', async (t) => {
  const root = await fixture(t);
  await buildKnowledgeIndex(root, { now: () => new Date('2026-09-20T00:00:00.000Z') });
  await writeConfig(root, 'fake-v2', 24);
  const report = await rebuildKnowledgeIndex(root, { now: () => new Date('2026-09-20T01:00:00.000Z') });
  assert.equal(report.replaced, true);
  assert.equal(report.model, 'fake-v2');
  assert.equal(report.dimensions, 24);
  const manifest = JSON.parse(await readFile(path.join(root, INDEX_ROOT, INDEX_FILES.manifest), 'utf8'));
  assert.equal(manifest.generatedAt, '2026-09-20T01:00:00.000Z');
  assert.equal(manifest.embedding.model, 'fake-v2');
  assert.equal(manifest.embedding.dimensions, 24);
});

test('rebuild 在索引不存在时执行首次构建', async (t) => {
  const root = await fixture(t);
  const report = await rebuildKnowledgeIndex(root);
  assert.equal(report.replaced, false);
  assert.equal((await statusKnowledgeIndex(root)).exists, true);
});

test('clear 只删除派生索引且重复调用幂等', async (t) => {
  const root = await fixture(t);
  await buildKnowledgeIndex(root);
  assert.deepEqual(await clearKnowledgeIndex(root), {
    ok: true, action: 'clear', indexPath: INDEX_ROOT, removed: true,
  });
  await assert.rejects(access(path.join(root, INDEX_ROOT)), { code: 'ENOENT' });
  await access(path.join(root, ENTRY));
  await access(path.join(root, INDEX_CONFIG_PATH));
  assert.equal((await clearKnowledgeIndex(root)).removed, false);
});

test('CLI rebuild 和 clear 返回稳定 JSON', async (t) => {
  const root = await fixture(t);
  let output = '';
  const io = { cwd: root, env: {}, stdout: { write: value => { output += value; } } };
  assert.equal(await main(['ui-knowledge', 'index', 'rebuild', '--json'], io), 0);
  assert.equal(JSON.parse(output).action, 'rebuild');
  output = '';
  assert.equal(await main(['ui-knowledge', 'index', 'clear', '--json'], io), 0);
  assert.equal(JSON.parse(output).removed, true);
});
