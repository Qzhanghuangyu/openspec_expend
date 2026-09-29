import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseTaskProgress } from '../../src/coordination/comate.js';

const strict = body => `<!-- falla-tasks-format: 1 -->\n${body}`;
const kinds = markdown => parseTaskProgress(markdown).issues.map(({ kind }) => kind);

test('任务依赖解析同一行和续行，允许未完成前置等待并保留官方进度语义', () => {
  assert.deepEqual(parseTaskProgress(strict(`## 1. 契约
- [x] 1.1 契约（依赖：无）
- [x] 1.2 基础（依赖：[1.1]）
## 2. 实施
- [ ] 2.1 [人工] 核对
  - **前置依赖**: \`1.1\`、\`1.2\`
- [ ] 2.2 接线（依赖：2.1）
`)), { total: 4, complete: 2, pending: 2, humanTasks: 1, issues: [] });
});

test('新任务契约拒绝非法编号、缺失依赖字段、章节不符和前向依赖', () => {
  for (const [body, expected] of [
    ['## 1. 实施\n- [ ] T1 工作（依赖：无）', 'task-id-invalid'],
    ['## 1. 实施\n- [ ] 1 工作（依赖：无）', 'task-id-invalid'],
    ['## 1. 实施\n- [ ] 未编号（依赖：无）', 'task-id-invalid'],
    ['## 1. 实施\n- [ ] 1.1 工作', 'task-dependency-required'],
    ['## 1. 实施\n- [ ] 2.1 工作（依赖：无）', 'task-section-mismatch'],
    ['## 实施\n- [ ] 1.1 工作（依赖：无）', 'task-section-mismatch'],
    ['## 1. 实施\n- [ ] 1.1 工作（依赖：1.2）\n- [ ] 1.2 契约（依赖：无）', 'task-dependency-order'],
  ]) {
    assert.ok(kinds(strict(body)).includes(expected), expected);
  }
});

test('合法 Markdown 缩进章节不能沿用上一章节，任务内部标题不改变所属章节', () => {
  const body = ` ## 1. 契约
- [x] 1.1 A（依赖：无）

 ## 2. 实施
- [ ] 2.1 B
  ## 3. 任务内部说明
  - 依赖：1.1
`;
  assert.deepEqual(kinds(strict(body)), []);
  assert.ok(kinds(strict(body.replace('- [ ] 2.1 ', '- [ ] 1.2 '))).includes('task-section-mismatch'));
});

test('所有编号格式都检查重复、缺失、自依赖与依赖环', () => {
  for (const [body, expected] of [
    ['- [ ] 1.1 A\n- [ ] 1.1 B', 'task-id-duplicate'],
    ['- [ ] 1.1 A（依赖：9.9）', 'task-dependency-missing'],
    ['- [ ] 1.1 A（依赖：1.1）', 'task-dependency-self'],
    ['- [ ] 1.1 A（依赖：1.2）\n- [ ] 1.2 B（依赖：1.1）', 'task-dependency-cycle'],
    ['- [ ] T1 A\n- [ ] T1 B', 'task-id-duplicate'],
    ['- [ ] 1 A（依赖：2）', 'task-dependency-missing'],
  ]) {
    assert.ok(kinds(body).includes(expected), expected);
  }
});

test('依赖值必须为精确编号列表，不能用空字段、重复字段或模糊文字绕过', () => {
  for (const declaration of ['依赖：', '依赖：全部实施任务', '依赖：1.1、', '依赖：无、1.1',
    '依赖：[1.1', '依赖：1.1；依赖：无', '依赖：1.1、1.1']) {
    assert.ok(kinds(`- [x] 1.1 A\n- [ ] 2.1 B（${declaration}）`)
      .includes('task-dependency-invalid'), declaration);
  }
  assert.ok(kinds('- [ ] 未编号（依赖：1.1）').includes('task-id-invalid'));
});

test('已完成任务不能依赖未完成前置，复验或撤销后恢复合法', () => {
  const invalid = '- [ ] 1.1 A（依赖：无）\n- [x] 2.1 B（依赖：1.1）';
  assert.deepEqual(kinds(invalid), ['task-dependency-not-done']);
  assert.deepEqual(kinds(invalid.replace('- [x] 2.1', '- [ ] 2.1')), []);
  assert.deepEqual(kinds(invalid.replace('- [ ] 1.1', '- [x] 1.1')), []);
});

test('旧任务不重编；新格式不允许把 checkbox 示例当真实任务', () => {
  assert.deepEqual(kinds('- [x] T1 旧契约\n- [ ] T2 旧实现（依赖：T1）'), []);
  assert.deepEqual(kinds('- [x] 1. 旧契约\n- [ ] 2. 旧实现（依赖：1）'), []);
  assert.deepEqual(kinds('- [ ] 旧任务\n- [x] 其他任务'), []);
  const code = '```md\n- [ ] 1.1 示例（依赖：9.9）\n```';
  assert.deepEqual(parseTaskProgress(code), {
    total: 1, complete: 0, pending: 1, humanTasks: 0, issues: [],
  });
  assert.ok(kinds(strict(code)).includes('task-checkbox-in-code'));
});

test('依赖字段归属正确，代码示例和独立段落不污染相邻任务', () => {
  const markdown = `- [x] 1.1 A
- [ ] 2.1 B
  - [ ] 2.1.1 子任务（依赖：1.1）
  ### 父任务说明
  - 依赖：1.1
  \`\`\`text
  依赖：不存在
  \`\`\`

独立段落（依赖：不存在）
- 普通列表（依赖：不存在）
`;
  assert.deepEqual(kinds(markdown), []);
});

test('嵌套任务结束后的外层代码块保留外层依赖字段归属', () => {
  assert.deepEqual(kinds(strict(`## 1. 前置
- [x] 1.1 A（依赖：无）
## 2. 实施
- [ ] 2.1 外层
  - [ ] 2.2 内层（依赖：1.1）
  \`\`\`text
  外层说明
  \`\`\`
  - 依赖：1.1
`)), []);
});

test('任务诊断仅含稳定编号与行号，不返回任务正文和无效依赖文本', () => {
  const issues = parseTaskProgress('- [ ] 1.1 PRIVATE_TASK（依赖：SECRET_TOKEN）\n- [ ] 1.1 PRIVATE_DUPLICATE').issues;
  assert.deepEqual(issues, [
    { kind: 'task-dependency-invalid', line: 1, task: '1.1' },
    { kind: 'task-id-duplicate', line: 2, task: '1.1', relatedLine: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(issues), /PRIVATE|SECRET/);
});

test('未知格式版本会失败，长依赖链不会耗尽递归栈', () => {
  assert.deepEqual(kinds('<!-- falla-tasks-format: 99 -->\n- [ ] 1.1 A'), ['task-format-invalid']);
  const chain = Array.from({ length: 6000 }, (_, index) =>
    `- [ ] 1.${index + 1} A（依赖：${index === 5999 ? '无' : `1.${index + 2}`}）`).join('\n');
  assert.deepEqual(kinds(chain), []);
});

test('父子模板填入精确依赖后可校验，保留格式标记才能拒绝旧式新编号', async () => {
  for (const schema of ['falla-spec-driven', 'falla-task-driven']) {
    const template = await readFile(`templates/openspec/schemas/${schema}/templates/tasks.md`, 'utf8');
    const tasks = template.replaceAll(/依赖：<[^>]+>/gu, '依赖：2.2');
    assert.deepEqual(kinds(tasks), [], schema);
    assert.equal(parseTaskProgress(tasks).total, 7);
    assert.ok(kinds(tasks.replace('- [ ] 1.1 ', '- [ ] T1 ')).includes('task-id-invalid'), schema);
  }
});
