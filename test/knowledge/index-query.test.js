import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { main } from '../../src/cli.js';
import { buildKnowledgeIndex } from '../../src/knowledge/index/build.js';
import { INDEX_CONFIG_PATH, defaultIndexConfig } from '../../src/knowledge/index/config.js';
import { INDEX_FILES, INDEX_ROOT } from '../../src/knowledge/index/contract.js';
import { queryKnowledgeIndex } from '../../src/knowledge/index/query.js';

const SOURCE = 'app/src/main/java/Demo.kt';

function entry(id, content) {
  const data = {
    'schema-version': 1, id, kind: 'component', scope: 'project', status: 'draft',
    platform: 'android-view', aliases: [id], intents: [content], tags: ['test'],
    codegraph: { 'primary-symbol': 'Demo', 'related-symbols': [] },
    'source-files': [SOURCE], 'layout-resources': [], tests: [],
    'source-hashes': {}, 'last-verified': null, 'verified-by': '',
  };
  return `---\n${YAML.stringify(data)}---\n# ${id}\n\n## 适用场景\n\n${content}\n`;
}

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-index-query-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'openspec'));
  await mkdir(path.join(root, '.falla/ui-knowledge/components'), { recursive: true });
  await mkdir(path.join(root, path.dirname(SOURCE)), { recursive: true });
  await writeFile(path.join(root, SOURCE), 'class Demo\n');
  const config = defaultIndexConfig();
  config.semantic = { ...config.semantic, provider: 'fake', model: 'fake-v1', dimensions: 16, topK: 2 };
  await writeFile(path.join(root, INDEX_CONFIG_PATH), YAML.stringify(config));
  await writeFile(path.join(root, '.falla/ui-knowledge/components/alpha.md'), entry('alpha', 'Alpha animation'));
  await writeFile(path.join(root, '.falla/ui-knowledge/components/beta.md'), entry('beta', 'Beta list'));
  await buildKnowledgeIndex(root);
  return root;
}

test('query 对完全相同 chunk 返回最高分并按文档聚合', async (t) => {
  const root = await fixture(t);
  const chunkLines = (await readFile(path.join(root, INDEX_ROOT, INDEX_FILES.chunks), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  const target = chunkLines.find(chunk => chunk.documentId === 'alpha' && chunk.section === '适用场景');
  const report = await queryKnowledgeIndex(root, target.text);
  assert.equal(report.topK, 2);
  assert.equal(report.candidates[0].id, 'alpha');
  assert.equal(report.candidates[0].score, 1);
  assert.equal(report.candidates[0].validation, 'current');
  assert.equal(report.candidates[0].reuseMode, 'reference-only');
  assert.ok(report.candidates[0].matchedSections.includes('适用场景'));
  assert.equal(report.candidates.length, 2);
});

test('query 在 Markdown 变化后标记旧索引 stale 且禁止复用', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, '.falla/ui-knowledge/components/alpha.md'), entry('alpha', 'Changed'));
  const report = await queryKnowledgeIndex(root, 'Alpha animation');
  const candidate = report.candidates.find(item => item.id === 'alpha');
  assert.equal(candidate.validation, 'stale');
  assert.equal(candidate.reuseMode, 'rejected');
});

test('CLI query 支持配置 topK 和显式覆盖且不输出 chunk 正文', async (t) => {
  const root = await fixture(t);
  let output = '';
  const io = { cwd: root, env: {}, stdout: { write: value => { output += value; } } };
  assert.equal(await main(['ui-knowledge', 'index', 'query', '--text', 'Alpha animation', '--top-k', '1', '--json'], io), 0);
  const report = JSON.parse(output);
  assert.equal(report.topK, 1);
  assert.equal(report.candidates.length, 1);
  assert.equal(Object.hasOwn(report.candidates[0], 'text'), false);
});
