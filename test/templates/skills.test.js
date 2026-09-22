import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const root = path.resolve('templates');
const expectedSkills = ['falla-apply-change', 'falla-archive-change', 'falla-preflight', 'falla-propose'];
const expectedReferences = [
  'android-quality.md',
  'code-search.md',
  'coordination.md',
  'design-tools.md',
  'project-rules.md',
  'ui-knowledge.md',
];
const read = relative => readFile(path.join(root, relative), 'utf8');

function parseFrontmatter(content, source) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${source} 缺少 YAML frontmatter`);
  return YAML.parse(match[1]);
}

test('四个 Skill 具备合法元数据且 OpenAI 元数据一致', async () => {
  const entries = (await readdir(path.join(root, 'skills'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(entries, expectedSkills);
  for (const name of entries) {
    const content = await read(`skills/${name}/SKILL.md`);
    const metadata = parseFrontmatter(content, name);
    assert.equal(metadata.name, name);
    assert.match(metadata.description, /^Use when /);
    const openai = YAML.parse(await read(`skills/${name}/agents/openai.yaml`));
    assert.match(openai.interface.default_prompt, new RegExp(`\\$${name}\\b`));
  }
});

test('规则目录包含五个入口文档、一个强制门禁和五个按需参考', async () => {
  const entries = await readdir(path.join(root, 'skill-spec'), { withFileTypes: true });
  assert.deepEqual(
    entries.filter(entry => entry.isFile()).map(entry => entry.name).sort(),
    ['[Must Read]soul.md', '[任务选读]archive.md', '[分析必读]preflight.md', '[架构必读]propose.md', '[模块选读]apply.md'].sort()
  );
  assert.deepEqual(
    (await readdir(path.join(root, 'skill-spec', 'references'))).sort(),
    expectedReferences
  );
  const contents = await Promise.all([
    ...entries.filter(entry => entry.isFile()).map(entry => read(`skill-spec/${entry.name}`)),
    ...expectedReferences.map(file => read(`skill-spec/references/${file}`)),
  ]);
  const content = contents.join('\n');
  assert.doesNotMatch(content, /mercuryspec\//);
  assert.doesNotMatch(content, /\bfalla (?:new|list|status|instructions)\b/);
  assert.match(content, /openspec\/specs/);
});

test('Soul 保持精简并只定义全局原则与事实源', async () => {
  const soul = await read('skill-spec/[Must Read]soul.md');
  assert.ok(soul.split('\n').length <= 80, 'Soul 不应重新膨胀为全量操作手册');
  assert.match(soul, /当前阶段读什么/);
  assert.match(soul, /唯一事实源/);
  assert.match(soul, /五条原则/);
  for (const file of expectedReferences) assert.match(soul, new RegExp(file.replace('.', '\\.')));
  assert.doesNotMatch(soul, /excludeScreenshot=true|KDoc\/JavaDoc|source-hashes/);
});

test('四个阶段规则使用统一的可执行结构', async () => {
  const files = ['[分析必读]preflight.md', '[架构必读]propose.md', '[模块选读]apply.md', '[任务选读]archive.md'];
  for (const file of files) {
    const content = await read(`skill-spec/${file}`);
    assert.match(content, /## 目标/);
    assert.match(content, /## 输入/);
    assert.match(content, /## 必须执行/);
    assert.match(content, /## 何时暂停/);
    assert.match(content, /## 完成标准/);
    assert.match(content, /## 按需参考/);
    assert.doesNotMatch(content, /excludeScreenshot=true/, `${file} 不应复制工具参数细节`);
  }
});

test('Skill 只编排命令并引用阶段权威规则', async () => {
  const expectations = {
    'falla-preflight': ['[分析必读]preflight.md', 'openspec instructions preflight'],
    'falla-propose': ['[架构必读]propose.md', 'openspec instructions <proposal|specs|design|tasks|comate>'],
    'falla-apply-change': ['[模块选读]apply.md', 'openspec instructions apply'],
    'falla-archive-change': ['[任务选读]archive.md', 'openspec instructions archive'],
  };
  for (const [name, patterns] of Object.entries(expectations)) {
    const content = await read(`skills/${name}/SKILL.md`);
    for (const pattern of patterns) assert.ok(content.includes(pattern), `${name} 缺少 ${pattern}`);
    assert.match(content, /Hook 注入时不要重复读取/);
    assert.ok(content.split('\n').length < 80, `${name} 仍过度承载阶段政策`);
  }
});

test('阶段职责保持单向推进', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const propose = await read('skill-spec/[架构必读]propose.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const archive = await read('skill-spec/[任务选读]archive.md');
  assert.match(preflight, /只产出 `preflight\.md`/);
  assert.match(propose, /本阶段只规划，不修改业务代码/);
  assert.match(propose, /不得重新执行一次完整 preflight/);
  assert.match(apply, /不重新分析需求、不重新拆分 change/);
  assert.match(archive, /不得在本阶段重新实施需求/);
});

test('执行和验证模式只由 comate 保存', async () => {
  const parentTasks = await read('openspec/schemas/falla-spec-driven/templates/tasks.md');
  const childTasks = await read('openspec/schemas/falla-task-driven/templates/tasks.md');
  const parentComate = await read('openspec/schemas/falla-spec-driven/templates/comate.md');
  const childComate = await read('openspec/schemas/falla-task-driven/templates/comate.md');
  assert.doesNotMatch(parentTasks, /^- 模式：/m);
  assert.doesNotMatch(childTasks, /^- 模式：/m);
  assert.match(parentComate, /execution-mode\): single/);
  assert.match(parentComate, /validation-mode\): hybrid/);
  assert.doesNotMatch(childComate, /execution-mode/);
  assert.match(childComate, /validation-mode\): hybrid/);
});

test('依赖只保存 depends-on，blocks 由协调器推导', async () => {
  for (const file of [
    'openspec/schemas/falla-spec-driven/templates/comate.md',
    'openspec/schemas/falla-task-driven/templates/comate.md',
  ]) {
    const content = await read(file);
    assert.match(content, /depends-on/);
    assert.doesNotMatch(content, /\(blocks\)/);
  }
  const coordination = await read('skill-spec/references/coordination.md');
  assert.match(coordination, /反向 blocks 由协调器推导/);
});

test('按需参考保留安全、生命周期和工具约束', async () => {
  const design = await read('skill-spec/references/design-tools.md');
  const search = await read('skill-spec/references/code-search.md');
  const knowledge = await read('skill-spec/references/ui-knowledge.md');
  const quality = await read('skill-spec/references/android-quality.md');
  const coordination = await read('skill-spec/references/coordination.md');
  const projectRules = await read('skill-spec/references/project-rules.md');

  assert.match(design, /excludeScreenshot=true/);
  assert.match(design, /不得使用浏览器、WebFetch、`curl`/);
  assert.match(search, /修改公共类、公共方法.*必须用 CodeGraph/s);
  assert.match(search, /禁止索引或输出凭据/);
  assert.match(search, /默认分析当前工作树/);
  assert.match(search, /只有用户明确要求分析变更沿革/);
  assert.match(knowledge, /source-hashes/);
  assert.match(knowledge, /禁止读取、召回、合并或复制其他项目/);
  assert.match(quality, /Android XML/);
  assert.match(quality, /KDoc\/JavaDoc/);
  assert.match(quality, /页面销毁后 UI 更新/);
  assert.match(quality, /敏感日志/);
  assert.match(coordination, /一次只推进一个 ready task/);
  assert.match(coordination, /跨机器或不同工作树/);
  assert.match(projectRules, /Propose 和 Apply 必读/);
  assert.match(projectRules, /每条 `required` 都必须.*出现/s);
  assert.match(projectRules, /适用.*不适用.*冲突.*例外/s);
});


test('Propose 和 Apply 对每条 required 项目规则执行完整审计', async () => {
  const propose = await read('skill-spec/[架构必读]propose.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const designTemplate = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const parentSchema = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const guard = await read('hooks/falla-spec-guard.mjs');

  assert.match(propose, /必读 `references\/project-rules\.md`/);
  assert.match(propose, /每条 required.*适用\/不适用\/冲突\/已批准例外/s);
  assert.match(apply, /必读 `references\/project-rules\.md`/);
  assert.match(apply, /遗漏、条件变化或偏离时不修改代码/s);
  assert.match(designTemplate, /## 项目规则审计/);
  assert.match(designTemplate, /适用 \/ 不适用 \/ 冲突 \/ 已批准例外/);
  assert.match(parentSchema, /每条 required 都分类/);
  assert.match(guard, /falla-propose.*references\/project-rules\.md/s);
  assert.match(guard, /falla-apply-change.*references\/project-rules\.md/s);
});

test('Apply 使用完成即落盘的单任务循环', async () => {
  const apply = await read('skill-spec/[模块选读]apply.md');
  assert.match(apply, /## 黄金规则/);
  assert.match(apply, /一次只处理一个 ready task/);
  assert.match(apply, /立即把对应 checkbox 从 `\[ \]` 改为 `\[x\]`/);
  assert.match(apply, /同步更新 handoff 后，才能开始下一个 task/);
  assert.match(apply, /不为后续 task 提前改动/);
  assert.match(apply, /不得提前勾选或最后批量补勾/);
  assert.match(apply, /状态落盘后重新读取 instructions\/tasks/);
});

test('OpenSpec 1.12 特殊语义仍保留', async () => {
  const propose = await read('skills/falla-propose/SKILL.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const archive = await read('skills/falla-archive-change/SKILL.md');
  assert.match(propose, /skip_specs: true/);
  assert.match(propose, /允许数字开头/);
  assert.match(apply, /operationGuidance/);
  assert.match(archive, /retire_capabilities: true/);
  assert.match(archive, /--no-validate/);
  assert.match(archive, /--skip-specs/);
  assert.match(archive, /不得使用 `--force`、`--skip-validate`/);
});

test('Schema instruction 只描述 artifact，不复制工具政策', async () => {
  const parent = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const child = await read('openspec/schemas/falla-task-driven/schema.yaml');
  for (const content of [parent, child]) {
    assert.doesNotMatch(content, /excludeScreenshot|get_screenshot|Figma MCP/);
    assert.doesNotMatch(content, /codegraph prepare|ui-knowledge validate/);
  }
});
