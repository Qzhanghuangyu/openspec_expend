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
  assert.match(projectRules, /不得只读取索引/);
  assert.match(projectRules, /`index.md` 若存在，应只作文件与 Rule ID 导航/);
  assert.match(projectRules, /目录漏列文件时.*仍读取磁盘上全部顶层规则文件/s);
  assert.match(projectRules, /旧项目若仍把规则正文写在 `index.md`，继续审计/);
  assert.match(projectRules, /保持 Rule ID 不变.*避免同一条规则在两处重复定义/s);
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

test('XML 页面在 design 中列简要布局层级，Compose 不强加 XML', async () => {
  const designTemplate = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const parentSchema = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const propose = await read('skill-spec/[架构必读]propose.md');

  assert.match(designTemplate, /### XML 布局结构/);
  assert.match(designTemplate, /res\/layout\/<页面>\.xml/);
  assert.match(designTemplate, /└─ <状态容器类型>/);
  assert.match(designTemplate, /纯 Compose 或非页面变更写“不适用”/);
  assert.match(parentSchema, /使用 XML 的页面须在 design 中列出实际或拟新增的 res\/layout 文件及简要节点树/);
  assert.match(propose, /使用 XML 的页面在 `design\.md` 列出布局文件与关键节点层级/);
  assert.match(designTemplate, /现有结构须核对源码/);
  assert.match(designTemplate, /不写完整 XML 属性/);
});

test('飞书 PRD 的 Preflight 合并正文与完整评论线程，未决意见不算已确认', async () => {
  const phase = await read('skill-spec/[分析必读]preflight.md');
  const skill = await read('skills/falla-preflight/SKILL.md');
  const schema = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const template = await read('openspec/schemas/falla-spec-driven/templates/preflight.md');

  assert.match(phase, /docs \+fetch --doc "<PRD URL>" --scope full/);
  assert.match(phase, /drive \+list-comments --url "<PRD URL>" --solved-status all --comment-scope all/);
  assert.match(phase, /# 对每个 comment_id/);
  assert.match(phase, /drive \+list-replies --url "<PRD URL>" --comment-id "<id>"/);
  assert.match(phase, /reference_map\.comments/);
  assert.match(phase, /--page-token/);
  assert.match(phase, /“已解决”不等于已确认/);
  assert.match(phase, /记录正文版本和评论核对时间/);
  assert.match(phase, /评论接口无权限、失败或分页\/截断未补齐时/);
  assert.match(phase, /不复制整段评论或个人信息/);
  assert.match(skill, /读取评论及回复（含已解决评论与分页）/);
  assert.match(schema, /飞书文档\/Wiki PRD 须核对正文和可见评论/);
  assert.match(template, /## 飞书 PRD 评论核对/);
  assert.match(template, /正文与已确认评论合并后的需求口径/);
  assert.doesNotMatch(phase, /docs \+(?:get|export)/);
});

test('Figma 节点跨会话从 preflight 交接到 design，Apply 只复用授权范围', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const preflightSkill = await read('skills/falla-preflight/SKILL.md');
  const preflightTemplate = await read('openspec/schemas/falla-spec-driven/templates/preflight.md');
  const propose = await read('skill-spec/[架构必读]propose.md');
  const proposeSkill = await read('skills/falla-propose/SKILL.md');
  const designTemplate = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const parentSchema = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const designRules = await read('skill-spec/references/design-tools.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const applySkill = await read('skills/falla-apply-change/SKILL.md');
  const childSchema = await read('openspec/schemas/falla-task-driven/schema.yaml');

  assert.match(preflightTemplate, /## 设计节点交接/);
  assert.match(preflightTemplate, /file key、精确 node id/);
  assert.match(preflightTemplate, /不保存原始链接、查询参数/);
  assert.match(preflight, /写入 `preflight\.md` 的“设计节点交接”/);
  assert.match(preflightSkill, /写入 `preflight\.md` 的“设计节点交接”/);
  assert.match(parentSchema, /在 preflight 中持久记录确认范围/);
  assert.match(propose, /先读 `preflight\.md` 的“设计节点交接”/);
  assert.match(propose, /先把最小授权记录追加到 preflight/);
  assert.match(proposeSkill, /可写后归并到 `design\.md`/);
  assert.match(designTemplate, /## 设计源证据/);
  assert.match(designTemplate, /项目内相对路径、下载状态及本地普通文件哈希/);
  assert.match(designTemplate, /状态（未核对 \/ 已核对 \/ 失败）/);
  assert.match(designRules, /不要求用户重复粘贴同一链接/);
  assert.match(designRules, /已记录的授权仅覆盖原 change 和精确节点/);
  assert.match(designRules, /哈希吻合时可直接复用/);
  assert.match(designRules, /不跟随符号链接或越界路径/);
  assert.match(designRules, /超出已确认范围，先请用户确认/);
  assert.match(designRules, /Apply 暂停当前任务并返回 Propose/);
  assert.match(apply, /复用本地资源前核对文件存在且哈希吻合/);
  assert.match(applySkill, /核对所需本地资源存在且哈希吻合/);
  assert.match(childSchema, /复用本地资源前核对文件/);
});

test('注释豁免须逐符号审计，不能把短方法当简单方法跳过', async () => {
  const quality = await read('skill-spec/references/android-quality.md');
  const design = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const parentSchema = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const apply = await read('skill-spec/[模块选读]apply.md');
  for (const schema of ['falla-spec-driven', 'falla-task-driven']) {
    const tasks = await read(`openspec/schemas/${schema}/templates/tasks.md`);
    const comate = await read(`openspec/schemas/${schema}/templates/comate.md`);
    assert.match(tasks, /逐符号审计注释/);
    assert.match(comate, /已补注释的符号与说明/);
    assert.match(comate, /豁免项及原因（逐符号列出/);
  }
  assert.match(quality, /方法短不等于简单/);
  assert.match(quality, /生命周期回调、事件处理和状态\/异步方法不能仅凭行数豁免/);
  assert.match(quality, /缺项不得勾选 task/);
  assert.match(design, /短方法不能自动豁免/);
  assert.match(parentSchema, /不能按方法行数豁免/);
  assert.match(apply, /方法短、编译通过或“简单方法”不是豁免理由/);
  assert.match(apply, /缺注释或未审计时不勾选 task/);
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
