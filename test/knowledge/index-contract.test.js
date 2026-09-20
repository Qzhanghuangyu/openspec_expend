import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { main, usage } from '../../src/cli.js';
import {
  CHUNK_STRATEGY_VERSION,
  DEFAULT_TOP_K,
  INDEX_ACTIONS,
  INDEX_FILES,
  INDEX_FORMAT_VERSION,
  INDEX_ROOT,
  KNOWLEDGE_SCHEMA_VERSION,
  MAX_TOP_K,
  createEmptyIndexManifest,
} from '../../src/knowledge/index/contract.js';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-index-contract-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'openspec'));
  return root;
}

function ioFor(root) {
  let output = '';
  return {
    io: { cwd: root, env: {}, stdout: { write: value => { output += value; } } },
    output: () => output,
  };
}

test('索引契约固定 V1 文件和默认参数', () => {
  assert.equal(INDEX_FORMAT_VERSION, 1);
  assert.equal(KNOWLEDGE_SCHEMA_VERSION, 1);
  assert.equal(CHUNK_STRATEGY_VERSION, 1);
  assert.equal(INDEX_ROOT, '.falla/ui-knowledge/.index');
  assert.deepEqual(INDEX_FILES, {
    manifest: 'manifest.json', chunks: 'chunks.jsonl', vectors: 'vectors.json',
  });
  assert.deepEqual(INDEX_ACTIONS, ['build', 'sync', 'query', 'status', 'rebuild', 'clear']);
  assert.equal(DEFAULT_TOP_K, 8);
  assert.equal(MAX_TOP_K, 50);
  assert.deepEqual(createEmptyIndexManifest(), {
    formatVersion: 1,
    knowledgeSchemaVersion: 1,
    chunkStrategyVersion: 1,
    embedding: { provider: 'unconfigured', model: 'unconfigured', dimensions: null },
    documents: {},
  });
  assert.throws(() => createEmptyIndexManifest({ dimensions: 0 }), /dimensions/);
});

test('CLI help 暴露 ui-knowledge index 契约', () => {
  assert.match(usage(), /ui-knowledge index build/);
  assert.match(usage(), /ui-knowledge index query/);
});

test('所有有效索引动作暂时明确返回未实现且不写索引', async (t) => {
  const root = await fixture(t);
  for (const action of INDEX_ACTIONS.filter(value => !['build', 'sync', 'query', 'status'].includes(value))) {
    const capture = ioFor(root);
    const args = action === 'query'
      ? ['ui-knowledge', 'index', action, '--text', 'H5 动画', '--top-k', '5', '--json']
      : ['ui-knowledge', 'index', action, '--json'];
    assert.equal(await main(args, capture.io), 1);
    const report = JSON.parse(capture.output());
    assert.equal(report.ok, false);
    assert.equal(report.implemented, false);
    assert.equal(report.action, action);
    if (action === 'query') assert.deepEqual(report.request, { text: 'H5 动画', topK: 5 });
  }
  await assert.rejects(access(path.join(root, INDEX_ROOT)), { code: 'ENOENT' });
});

test('query 强制 text 和合法 top-k，其他动作拒绝查询参数', async (t) => {
  const root = await fixture(t);
  await assert.rejects(main(['ui-knowledge', 'index', 'query', '--json'], ioFor(root).io), /ui-knowledge index query/);
  await assert.rejects(main(['ui-knowledge', 'index', 'query', '--text', 'x', '--top-k', '0'], ioFor(root).io), /ui-knowledge index query/);
  await assert.rejects(main(['ui-knowledge', 'index', 'query', '--text', 'x', '--top-k', '51'], ioFor(root).io), /ui-knowledge index query/);
  await assert.rejects(main(['ui-knowledge', 'index', 'build', '--text', 'x'], ioFor(root).io), /ui-knowledge index query/);
});
