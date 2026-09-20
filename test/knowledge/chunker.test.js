import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import {
  MAX_CHUNK_BYTES,
  chunkKnowledgeDocument,
} from '../../src/knowledge/index/chunker.js';
import { loadIndexableKnowledge } from '../../src/knowledge/index/documents.js';

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
    intents: ['验证稳定分块'],
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

function markdown(body, overrides = {}) {
  return `---\n${YAML.stringify(metadata(overrides))}---\n${body}`;
}

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-chunker-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, path.dirname(ENTRY)), { recursive: true });
  await mkdir(path.join(root, path.dirname(SOURCE)), { recursive: true });
  await mkdir(path.join(root, 'openspec'));
  await writeFile(path.join(root, SOURCE), 'class DemoView\n');
  return root;
}

test('按 metadata 和二级标题生成稳定 chunk，代码块标题不拆分', () => {
  const text = markdown(`# DemoView\n\n说明。\n\n## 适用场景\n\n用于列表。\n\n## 风险与限制\n\n\`\`\`markdown\n## 这不是章节\n\`\`\`\n`);
  const chunks = chunkKnowledgeDocument({
    file: ENTRY, kind: 'component', text, data: metadata(), reuse: 'reference-only',
  });
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].chunkId, 'component:demo-view#metadata');
  assert.match(chunks[0].text, /aliases: 演示组件/);
  assert.ok(chunks.some(chunk => chunk.section === '适用场景'));
  const risk = chunks.find(chunk => chunk.section === '风险与限制');
  assert.match(risk.text, /## 这不是章节/);
  assert.match(risk.chunkId, /^component:demo-view#section-[a-f0-9]{12}$/u);
  assert.ok(chunks.every(chunk => /^[a-f0-9]{64}$/u.test(chunk.textHash)));
});

test('插入其他章节不改变已有标题的 chunk ID', () => {
  const before = markdown('# DemoView\n\n## Usage\n\nA\n\n## Risks\n\nB\n');
  const after = markdown('# DemoView\n\n## Usage\n\nA\n\n## New Section\n\nC\n\n## Risks\n\nB\n');
  const options = text => ({ file: ENTRY, kind: 'component', text, data: metadata(), reuse: 'reference-only' });
  const beforeIds = chunkKnowledgeDocument(options(before)).map(chunk => chunk.chunkId);
  const afterIds = chunkKnowledgeDocument(options(after)).map(chunk => chunk.chunkId);
  assert.ok(beforeIds.includes('component:demo-view#usage'));
  assert.ok(beforeIds.includes('component:demo-view#risks'));
  assert.ok(afterIds.includes('component:demo-view#usage'));
  assert.ok(afterIds.includes('component:demo-view#risks'));
});

test('重复标题获得唯一 ID，超大单块被拒绝', () => {
  const duplicate = markdown('# DemoView\n\n## Usage\n\nA\n\n## Usage\n\nB\n');
  const chunks = chunkKnowledgeDocument({
    file: ENTRY, kind: 'component', text: duplicate, data: metadata(), reuse: 'reference-only',
  });
  assert.ok(chunks.some(chunk => chunk.chunkId === 'component:demo-view#usage'));
  assert.ok(chunks.some(chunk => chunk.chunkId === 'component:demo-view#usage-2'));

  const oversized = markdown(`# DemoView\n\n## Usage\n\n\`\`\`\n${'x'.repeat(MAX_CHUNK_BYTES)}\n\`\`\`\n`);
  assert.throws(() => chunkKnowledgeDocument({
    file: ENTRY, kind: 'component', text: oversized, data: metadata(), reuse: 'reference-only',
  }), error => error.details?.kind === 'knowledge-chunk-too-large');
});

test('安全装载只返回通过校验的候选且不创建索引目录', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, ENTRY), markdown('# DemoView\n\n## 适用场景\n\n用于测试。\n'));
  await writeFile(
    path.join(root, '.falla/ui-knowledge/components/invalid.md'),
    markdown('# Invalid\n', { id: 'invalid', platform: 'flutter' })
  );
  const result = await loadIndexableKnowledge(root);
  assert.equal(result.validation.ok, false);
  assert.deepEqual(result.documents.map(document => document.id), ['demo-view']);
  assert.equal(result.documents[0].reuse, 'reference-only');
  assert.ok(result.documents[0].chunks.length >= 2);
  await assert.rejects(access(path.join(root, '.falla/ui-knowledge/.index')), { code: 'ENOENT' });
});
