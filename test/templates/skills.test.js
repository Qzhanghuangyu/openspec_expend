import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const root = path.resolve('templates');
const expectedSkills = ['falla-apply-change', 'falla-archive-change', 'falla-preflight', 'falla-propose'];
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

test('规则文件使用标准 OpenSpec 路径', async () => {
  const files = (await readdir(path.join(root, 'skill-spec'))).sort();
  assert.equal(files.length, 5);
  const content = (await Promise.all(files.map(file => read(`skill-spec/${file}`)))).join('\n');
  assert.doesNotMatch(content, /mercuryspec\//);
  assert.doesNotMatch(content, /\bfalla (?:new|list|status|instructions)\b/);
  assert.match(content, /openspec\/specs/);
});

test('Soul 是跨阶段政策唯一权威入口', async () => {
  const soul = await read('skill-spec/[Must Read]soul.md');
  assert.match(soul, /权威职责与事实源/);
  assert.match(soul, /设计稿链接必须走对应的 MCP/);
  assert.match(soul, /CodeGraph 与有界文本检索分工/);
  assert.match(soul, /项目强制规则/);
  assert.match(soul, /当前需求范围锁/);
  assert.match(soul, /安全与完成边界/);

  for (const file of ['[分析必读]preflight.md', '[架构必读]propose.md', '[模块选读]apply.md', '[任务选读]archive.md']) {
    const phase = await read(`skill-spec/${file}`);
    assert.match(phase, /统一继承 `\[Must Read\]soul\.md`/);
    assert.doesNotMatch(phase, /excludeScreenshot=true/, `${file} 不应复制 Figma 参数细节`);
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

test('Preflight、Propose、Apply、Archive 职责边界清晰', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const propose = await read('skill-spec/[架构必读]propose.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const archive = await read('skill-spec/[任务选读]archive.md');
  assert.match(preflight, /只创建或更新 `preflight\.md`/);
  assert.match(propose, /不重新执行一次完整 preflight/);
  assert.match(apply, /只验证\s*引用是否仍有效，不重新开展完整方案探索/s);
  assert.match(archive, /不重新实施或重新分析需求/);
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
  const soul = await read('skill-spec/[Must Read]soul.md');
  const propose = await read('skill-spec/[架构必读]propose.md');
  assert.match(soul, /反向 blocks 由 depends-on 推导/);
  assert.match(propose, /`blocks` 由协调器反向推导/);
});

test('OpenSpec 1.12 特殊语义仍保留', async () => {
  const propose = await read('skills/falla-propose/SKILL.md');
  const apply = await read('skills/falla-apply-change/SKILL.md');
  const applyRule = await read('skill-spec/[模块选读]apply.md');
  const archive = await read('skills/falla-archive-change/SKILL.md');
  assert.match(propose, /skip_specs: true/);
  assert.match(propose, /允许数字开头/);
  assert.match(applyRule, /operationGuidance/);
  assert.match(archive, /retire_capabilities: true/);
  assert.match(archive, /--no-validate/);
  assert.match(archive, /--skip-specs/);
  assert.match(archive, /不得使用 `--force`、`--skip-validate`/);
});


test('权威规则保留关键安全、生命周期和工具边界', async () => {
  const soul = await read('skill-spec/[Must Read]soul.md');
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const propose = await read('skill-spec/[架构必读]propose.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const archive = await read('skill-spec/[任务选读]archive.md');

  assert.match(soul, /excludeScreenshot=true/);
  assert.match(soul, /不得调用 `get_screenshot`/);
  assert.match(soul, /修改公共类、公共方法.*必须用 CodeGraph/s);
  assert.match(soul, /Android XML 必须纵向、分层排版/);
  assert.match(soul, /KDoc\/JavaDoc/);
  assert.match(soul, /防止泄漏与销毁后更新/);
  assert.match(soul, /不在日志或报告中输出 token、密码、API Key/);
  assert.match(preflight, /默认只分析当前工作树/);
  assert.match(preflight, /不得读取 Git 历史/);
  assert.match(propose, /页面实现结构基线/);
  assert.match(propose, /required.*当前源码验证/s);
  assert.match(propose, /execution-mode: parallel.*仅用户明确要求/s);
  assert.match(apply, /建立.*范围锁/s);
  assert.match(apply, /滚动检查点/);
  assert.match(apply, /human-review: pending/);
  assert.match(archive, /--no-validate/);
  assert.match(archive, /--skip-specs/);
  assert.match(archive, /retire_capabilities: true/);
});

test('Schema instruction 只描述 artifact，不复制跨阶段工具政策', async () => {
  const parent = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const child = await read('openspec/schemas/falla-task-driven/schema.yaml');
  for (const content of [parent, child]) {
    assert.doesNotMatch(content, /excludeScreenshot|get_screenshot|Figma MCP/);
    assert.doesNotMatch(content, /codegraph prepare|ui-knowledge validate/);
  }
});

test('Apply 每完成一个最小 task 立即落盘状态', async () => {
  const applyRule = await read('skill-spec/[模块选读]apply.md');
  const applySkill = await read('skills/falla-apply-change/SKILL.md');
  const parentSchema = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const childSchema = await read('openspec/schemas/falla-task-driven/schema.yaml');

  assert.match(applyRule, /单任务原子循环/);
  assert.match(applyRule, /一次只推进一个当前可执行的最小 task/);
  assert.match(applyRule, /立即把对应 checkbox 从 `\[ \]` 改为 `\[x\]`/);
  assert.match(applyRule, /不得等待其他 task.*批量勾选/s);
  assert.match(applyRule, /不得\s*为后续 task 提前修改/s);
  assert.match(applyRule, /task 部分完成、验证失败或遇到阻塞时不得勾选/);
  assert.match(applyRule, /状态和 handoff 已落盘后.*下一个 ready task/s);
  assert.match(applySkill, /单任务原子循环/);
  assert.match(applySkill, /禁止累计多个 task 后批量勾选/);
  for (const schema of [parentSchema, childSchema]) {
    assert.match(schema, /一次只推进一个 ready task/);
    assert.match(schema, /立即勾选对应 checkbox/);
  }
});
