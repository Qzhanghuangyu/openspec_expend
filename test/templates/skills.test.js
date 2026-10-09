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

test('规则目录包含五个入口文档和六个参考规则，忽略 macOS 目录元数据', async () => {
  const entries = (await readdir(path.join(root, 'skill-spec'), { withFileTypes: true }))
    .filter(entry => entry.name !== '.DS_Store');
  assert.deepEqual(
    entries.filter(entry => entry.isFile()).map(entry => entry.name).sort(),
    ['[Must Read]soul.md', '[任务选读]archive.md', '[分析必读]preflight.md', '[架构必读]propose.md', '[模块选读]apply.md'].sort()
  );
  assert.deepEqual(
    (await readdir(path.join(root, 'skill-spec', 'references'))).filter(name => name !== '.DS_Store').sort(),
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

test('Soul 保持精简并只定义全局原则、编码原则与事实源', async () => {
  const soul = await read('skill-spec/[Must Read]soul.md');
  assert.ok(soul.split('\n').length <= 90, 'Soul 只保留精简编码原则，不应膨胀为全量操作手册');
  assert.match(soul, /当前阶段读什么/);
  assert.match(soul, /唯一事实源/);
  assert.match(soul, /五条原则/);
  assert.match(soul, /## 5\. 编码原则/);
  assert.match(soul, /## 6\. 全局底线/);
  assert.match(soul, /实现前说明关键假设/);
  assert.match(soul, /不同理解会影响行为或范围.*停止相关实施并提问.*不静默选择/);
  assert.match(soul, /最小实现.*不为单次使用预建抽象、配置.*无关依赖.*投机性兜底/);
  assert.match(soul, /只清理本次产生的无用代码.*无关重构、风格统一或死代码删除.*用户明确要求/s);
  assert.match(soul, /修 bug.*复现与验证方式.*新增能力.*可测试完成条件.*多步骤任务.*简短计划/);
  assert.match(soul, /编码后检查本次改动.*安全边界、泄露、泄漏、生命周期.*NPE.*依据、结论和未验证项/);
  assert.match(soul, /完整功能.*收尾任务集中检查资源所有权.*普通 task 不重复套整页清单/);
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

test('Preflight 澄清后停在当前阶段，Propose 和 Apply 必须分别手动发起', async () => {
  const soul = await read('skill-spec/[Must Read]soul.md');
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const propose = await read('skill-spec/[架构必读]propose.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const preflightSkill = await read('skills/falla-preflight/SKILL.md');
  const proposeSkill = await read('skills/falla-propose/SKILL.md');
  const applySkill = await read('skills/falla-apply-change/SKILL.md');
  const readme = await readFile('README.md', 'utf8');
  assert.match(soul, /preflight.*就绪.*不自动.*Propose/s);
  assert.match(soul, /Propose.*Apply.*用户.*分别.*手动调用/s);
  assert.match(soul, /同一 Apply 会话.*继续.*不.*重新调用 Skill/s);
  assert.match(preflight, /答复.*阻塞.*只更新.*preflight.*不.*Propose/s);
  assert.match(preflightSkill, /澄清.*停止.*Propose/s);
  assert.match(propose, /用户.*手动.*Propose/);
  assert.match(propose, /完成.*等待.*Apply/s);
  assert.match(apply, /用户.*手动.*Apply/);
  assert.match(proposeSkill, /不得自动.*Apply/);
  assert.match(applySkill, /不得.*自动.*Apply/);
  assert.match(readme, /P\[Preflight\].*用户手动发起.*D\[Propose\]/);
  assert.match(readme, /箭头不表示自动执行/);
  for (const name of ['falla-propose', 'falla-apply-change']) {
    const content = await read(`skills/${name}/SKILL.md`);
    assert.equal(parseFrontmatter(content, name)['disable-model-invocation'], true);
    const metadata = YAML.parse(await read(`skills/${name}/agents/openai.yaml`));
    assert.equal(metadata.policy.allow_implicit_invocation, false);
  }
});

test('Propose 对关键可见区域做层级及 spec/task 的有界覆盖核对', async () => {
  const propose = await read('skill-spec/[架构必读]propose.md');
  const design = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  assert.match(propose, /功能或视觉上显著.*区域.*父层/s);
  assert.match(propose, /design.*spec.*task/s);
  assert.match(propose, /范围外.*未取得/s);
  assert.match(propose, /任务生成后.*回填/s);
  assert.match(propose, /静态设计.*不得推断点击行为/s);
  assert.match(propose, /不逐.*叶节点.*不.*重复读取 Figma/s);
  assert.match(propose, /planningComplete.*不.*语义覆盖/s);
  assert.match(design, /对应 spec \/ task \/ 子 change \/ 范围外/);
  assert.match(design, /不列.*装饰性叶节点/);
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

test('增量 handoff 保留完成证据，审计当前符号并按规划节点收尾', async () => {
  const coordination = await read('skill-spec/references/coordination.md');
  assert.match(coordination, /每个 change 保持一个 handoff.*不新增逐轮日志文件/s);
  assert.match(coordination, /已完成任务的有效证据保留.*不能切换到下一 task 就删掉旧证据/s);
  assert.match(coordination, /引用原有 artifact 的章节或 Rule ID.*不复制全文/s);
  assert.match(coordination, /引用内容变化或不可访问时重新核对/);
  assert.match(coordination, /注释审计只覆盖本 task 新增或实质修改的符号.*先前未变化的文件不重复审计/s);
  assert.match(coordination, /收尾尚未执行时注明对应任务和待验证状态.*change done 前必须取得适用收尾证据/);
  assert.match(coordination, /未运行写未运行，不写通过/);
  assert.match(coordination, /必需内容不能删除/);
  assert.match(coordination, /不要求截图或过程材料/);
  for (const schema of ['falla-spec-driven', 'falla-task-driven']) {
    const comate = await read(`openspec/schemas/${schema}/templates/comate.md`);
    assert.match(comate, /字段保留，内容短写/);
    assert.match(comate, /按规划收尾 task 填写；其他 task 引用待验证任务或有效结果/);
  }
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
  assert.match(coordination, /每轮.*只推进一个 ready task/s);
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
  const designTemplate = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const guard = await read('hooks/falla-spec-guard.mjs');

  assert.match(designTemplate, /## 项目规则审计/);
  assert.match(designTemplate, /适用 \/ 不适用 \/ 冲突 \/ 已批准例外/);
  assert.match(guard, /falla-propose.*references\/project-rules\.md/s);
  assert.match(guard, /falla-apply-change.*references\/project-rules\.md/s);
});

test('XML 页面在 design 中列简要布局层级，Compose 不强加 XML', async () => {
  const designTemplate = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const propose = await read('skill-spec/[架构必读]propose.md');

  assert.match(designTemplate, /### XML 布局结构/);
  assert.match(designTemplate, /res\/layout\/<页面>\.xml/);
  assert.match(designTemplate, /└─ <状态容器类型>/);
  assert.match(propose, /使用 XML 的页面在 `design\.md` 列出布局文件与关键节点层级/);
});

test('飞书 PRD 的 Preflight 合并正文与完整评论线程，未决意见不算已确认', async () => {
  const phase = await read('skill-spec/[分析必读]preflight.md');
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
  assert.match(template, /## 飞书 PRD 评论核对/);
  assert.match(template, /正文与已确认评论合并后的需求口径/);
  assert.doesNotMatch(phase, /docs \+(?:get|export)/);
});

test('PRD 长评论 ID 和版本只写取证文件，Preflight 留可读结论', async () => {
  const phase = await read('skill-spec/[分析必读]preflight.md');
  const preflight = await read('openspec/schemas/falla-spec-driven/templates/preflight.md');
  const source = await read('openspec/schemas/falla-spec-driven/templates/prd-source.md');
  const propose = await read('skill-spec/[架构必读]propose.md');

  assert.match(source, /revision/);
  assert.match(source, /comment ID/);
  assert.match(source, /preflight 中的人可读主题/);
  assert.doesNotMatch(preflight, /评论 ID|comment.id|revision/);
  assert.match(preflight, /章节或问题主题.*精简结论/);
  assert.match(phase, /长评论 ID.*只记入父 change 的 `prd-source\.md`/s);
  assert.match(propose, /按需读取父 change 的.*`prd-source\.md`/s);
});

test('Figma 节点跨会话从 preflight 交接到 design，Apply 只复用授权范围', async () => {
  const sourceTemplate = await read('openspec/schemas/falla-spec-driven/templates/design-source.md');
  const designTemplate = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const designRules = await read('skill-spec/references/design-tools.md');

  assert.doesNotMatch(designTemplate, /file key|node id|本地普通文件哈希/);
  assert.match(sourceTemplate, /file key.*精确 node id/);
  assert.match(sourceTemplate, /项目内相对目标路径.*本地普通文件哈希/);
  assert.match(designTemplate, /## 设计源证据/);
  assert.match(designTemplate, /授权概要.*实施所需事实/s);
  assert.match(designRules, /不要求用户重复粘贴同一链接/);
  assert.match(designRules, /已记录的授权仅覆盖原 change 和精确节点/);
  assert.match(designRules, /哈希吻合时可直接复用/);
  assert.match(designRules, /不跟随符号链接或越界路径/);
  assert.match(designRules, /超出已确认范围，先请用户确认/);
  assert.match(designRules, /Apply 暂停当前任务并返回 Propose/);
});

test('Figma 已核对事实跨阶段复用，只有缺口或变化才定向补读', async () => {
  const sourceTemplate = await read('openspec/schemas/falla-spec-driven/templates/design-source.md');
  const designRules = await read('skill-spec/references/design-tools.md');

  assert.match(sourceTemplate, /已取得.*必要事实.*未取得/s);
  assert.match(designRules, /阶段切换.*不构成重读条件/);
  assert.match(designRules, /缺少.*必要.*只补读.*精确节点/s);
});

test('纯文本 UI 规格、运行时差异和人工视觉反馈形成闭环且不传截图', async () => {
  const designRules = await read('skill-spec/references/design-tools.md');
  const design = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const quality = await read('skill-spec/references/android-quality.md');

  assert.match(designRules, /excludeScreenshot=true/);
  assert.match(designRules, /默认不调用 `get_screenshot`/);
  assert.match(designRules, /get_screenshot\(contentsOnly=true\)/);
  assert.match(designRules, /未经核实不把 Figma\s*数值直接当成 Android dp/);
  assert.match(design, /### 关键节点文本规格/);
  assert.match(design, /Android 目标节点/);
  assert.match(design, /待澄清 \/ 人工视觉校准/);
  assert.match(quality, /## UI 文本核对与视觉边界/);
  assert.match(quality, /View 层级或 Compose 语义树/);
  assert.match(quality, /不能把设备物理 px 与 dp 直接相减/);
  assert.match(quality, /不把完整层级、真实业务数据或截图写进 handoff/);
  assert.match(quality, /不要求向模型上传图片/);
});

test('UI 设计条目从授权节点映射到页面状态和 task，不在实施文档泄露节点标识', async () => {
  const source = await read('openspec/schemas/falla-spec-driven/templates/design-source.md');
  const design = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const propose = await read('skill-spec/[架构必读]propose.md');
  const parentTasks = await read('openspec/schemas/falla-spec-driven/templates/tasks.md');
  const childTasks = await read('openspec/schemas/falla-task-driven/templates/tasks.md');

  assert.match(source, /设计条目 ID.*file key.*精确 node id/);
  assert.match(design, /条目 ID.*页面 \/ 状态.*可见区域与父层.*Android 目标节点.*对应 spec \/ task/);
  assert.doesNotMatch(design, /file key|node id/);
  assert.match(propose, /视觉上显著.*区域.*设计条目 ID.*task/s);
  for (const tasks of [parentTasks, childTasks]) {
    assert.match(tasks, /Figma UI task.*设计条目 ID.*页面 \/ 状态.*完成条件/);
  }
});

test('UI 缺口分类且 Apply 按设计条目回查，不以人工校准代替必需事实', async () => {
  const designRules = await read('skill-spec/references/design-tools.md');
  const design = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const quality = await read('skill-spec/references/android-quality.md');

  assert.match(designRules, /实施必需事实.*待澄清.*人工视觉校准/s);
  assert.match(design, /待澄清 \/ 人工视觉校准/);
  assert.match(apply, /Figma UI task.*设计条目 ID.*逐条回查/s);
  assert.match(quality, /设计条目.*逐条.*差异.*人工视觉校准/s);
});

test('Figma 用图仅复用成品或原生导出，透明新 PNG 验收后才可交付', async () => {
  const rules = await read('skill-spec/references/design-tools.md');
  const ledger = await read('openspec/schemas/falla-spec-driven/templates/design-source.md');

  assert.match(rules, /看图（理解设计）与用图（交付资源）是两条管线/);
  assert.match(rules, /`rawImages` 是原始图片，`export` 是节点渲染结果/);
  assert.match(rules, /原生 Export/);
  assert.match(rules, /显式指定 `png` 和 `scale=3`/);
  assert.match(rules, /需要 `svg` 时另核对 Android 交付方式/);
  assert.match(rules, /`scale=3` 对应 xxhdpi/);
  assert.match(rules, /`sips -g hasAlpha <file>`.*`hasAlpha: yes`/s);
  assert.match(rules, /已在项目中正式交付的资源.*不强制新增 Alpha/s);
  assert.match(rules, /MCP 无原生导出能力时，须先取得用户.*REST 降级授权/);
  assert.match(rules, /临时资源 URL 仅可通过批准的二进制下载方式/);
  assert.match(rules, /`rawImages`.*不得下载/s);
  assert.doesNotMatch(rules, /scale=2|2x.*临时核对/);
  assert.match(rules, /授权.*原生 Export.*`scale=3`/s);
  assert.match(rules, /设计逻辑尺寸.*实际像素.*3x/s);
  assert.match(ledger, /来源类型.*请求倍率.*设计逻辑尺寸.*实际像素.*本地普通文件哈希/);
});

test('按宽 AutoSizeConfig 与 1× 同宽设计稿可映射 dp，高度配置不是内容区上限', async () => {
  const designRules = await read('skill-spec/references/design-tools.md');
  const design = await read('openspec/schemas/falla-spec-driven/templates/design.md');
  const quality = await read('skill-spec/references/android-quality.md');

  assert.match(designRules, /已证实当前页面使用 AutoSizeConfig 按宽适配/);
  assert.match(designRules, /该页没有取消适配或改用按高\/自定义基准/);
  assert.match(designRules, /双方宽度均为 375 时，设计间距 16 对应 16dp/);
  assert.match(designRules, /不自动涵盖文字的 sp、字体缩放或位图资源/);
  assert.match(designRules, /设计稿高度（如 812）是参考画布，不用它修改 `design_height_in_dp`（如 667）/);
  assert.match(design, /画布宽高、单位与 1× 逻辑尺寸证据/);
  assert.match(design, /`design_width_in_dp`、`design_height_in_dp`/);
  assert.match(quality, /不能把设备物理 px 与 dp 直接相减/);
  assert.match(quality, /运行时复核页面实际适配与内容宽度/);
  assert.match(quality, /不按 667\/812 等比例压缩整页/);
});

test('注释豁免须逐符号审计，不能把短方法当简单方法跳过', async () => {
  const quality = await read('skill-spec/references/android-quality.md');

  assert.match(quality, /方法短不等于简单/);
  assert.match(quality, /生命周期回调、事件处理和状态\/异步方法不能仅凭行数豁免/);
  assert.match(quality, /缺项不得勾选 task/);
});

test('Propose 按能力与依赖拆任务，不强制固定 MVVM 或控件切法', async () => {
  const propose = await read('skill-spec/[架构必读]propose.md');

  assert.match(propose, /契约 → 独立逻辑\/组件 → 组装联调/);
  assert.match(propose, /不强制 View\/ViewModel 两项或每控件一项/);
  assert.match(propose, /输入、交付物、允许编辑范围、可测试完成条件和前置编号/);
});

test('父子 tasks 使用章节.序号且前置只引用精确编号', async () => {
  const propose = await read('skill-spec/[架构必读]propose.md');
  const parent = await read('openspec/schemas/falla-spec-driven/templates/tasks.md');
  const child = await read('openspec/schemas/falla-task-driven/templates/tasks.md');
  const parentSchema = await read('openspec/schemas/falla-spec-driven/schema.yaml');
  const childSchema = await read('openspec/schemas/falla-task-driven/schema.yaml');
  assert.match(propose, /章节\.序号.*1\.1.*1\.2.*2\.1/s);
  assert.match(propose, /不得使用 `T1`\/`T2`/);
  assert.match(propose, /前置依赖.*现存.*精确编号/s);
  assert.match(propose, /跨子 change.*`depends-on`/s);
  assert.match(propose, /`tasks\[\]\.id` 是顺序 ID.*不代替 tasks\.md 的人读编号/s);
  for (const template of [parent, child]) {
    assert.match(template, /编号格式.*章节\.序号/s);
    assert.match(template, /- \[ \] 1\.1 /);
    assert.match(template, /- \[ \] 2\.1 /);
    assert.doesNotMatch(template, /- \[ \] T\d+/);
  }
  assert.match(parentSchema, /任务和前置依赖.*章节\.序号/s);
  assert.match(childSchema, /任务和前置依赖.*章节\.序号/s);
});

// 文本契约回归只检查随包规则和字段，不能代替 Agent 的场景消费测试。
test('Preflight 先拆独立行为再调查实现，模板保留依据和核验缺口', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const template = await read('openspec/schemas/falla-spec-driven/templates/preflight.md');
  assert.match(preflight, /5\. 先按页面、区域或业务对象.*独立行为.*6\. 只调查需求范围.*7\. .*反查完整 PRD/s);
  assert.match(preflight, /触发条件、可观察结果或实现状态\s+不同的行为分开记录/);
  assert.match(preflight, /不按代码行、XML 属性或\s+装饰图层拆项/);
  assert.match(preflight, /简单静态需求允许只有一项/);
  assert.match(preflight, /关键分支或契约未核实.*无法判断.*核验缺口/s);
  assert.match(preflight, /不得仅因搜索不到就断言不存在/);
  assert.match(template, /编号.*页面\/对象.*独立行为.*触发.*可观察结果.*需求依据.*状态.*证据或核验缺口/);
  assert.doesNotMatch(template, /\| 需求项 \| 状态/);
  assert.match(template, /## 覆盖核对/);
  assert.match(template, /当前 Android 明确行为.*对应 R 编号/);
  assert.match(template, /尚未定义的行为缺口.*问题编号.*不得当作已确认规格/);
});

test('Preflight 按事实触发覆盖维度，问题按单一决定关联且不增加台账', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const template = await read('openspec/schemas/falla-spec-driven/templates/preflight.md');
  for (const dimension of ['展示与入口', '状态与交互', '数据与接口', '边界与异常', '兼容与生命周期']) {
    assert.ok(preflight.includes(`| ${dimension} |`), dimension);
  }
  assert.match(preflight, /事件、前后状态、状态来源及适用的持久化要求/);
  assert.match(preflight, /不要求每个功能都写五段/);
  assert.match(preflight, /不涉及权限就不加权限问题，没有提交就不加重复提交问题/);
  assert.match(preflight, /一个问题对应一个可独立答复的决定.*多个行为共享同一决定.*关联多个 R 编号/s);
  assert.match(preflight, /Blocker.*现有 `B1`.*Major\/Minor.*`Q1`.*不建立第二份决定状态台账/s);
  assert.match(preflight, /不新增独立台账文件或需求覆盖解析器/);
  assert.match(preflight, /只保存必要的脱敏结论.*项目内证据.*不复制 PRD 原文、业务数据或凭据/s);
  assert.match(template, /关联行为：/);
  assert.deepEqual(parseFrontmatter(template, 'preflight'), {
    'falla-preflight': 1, reviewed: false, blockers: [],
  });
});

test('Propose 逐行为承接并反查去向，父子 task 覆盖引用不改变编号和依赖', async () => {
  const propose = await read('skill-spec/[架构必读]propose.md');
  const parent = await read('openspec/schemas/falla-spec-driven/templates/tasks.md');
  const child = await read('openspec/schemas/falla-task-driven/templates/tasks.md');
  assert.match(propose, /proposal.*业务能力.*不把每个 R 编号变成一个 capability/);
  assert.match(propose, /specs.*已确认行为.*可测试场景.*skip_specs: true.*design\/tasks.*不.*创建 specs/s);
  assert.match(propose, /已实现无需改动、由具体任务覆盖、仍待确认或已明确排除.*不得无声遗漏/);
  assert.match(propose, /一个任务可以覆盖多个行为，一个行为也可由多个任务交付/);
  assert.match(propose, /缺少产品决定回 Preflight，已确认行为的方案或任务缺口留在 Propose/);
  assert.match(propose, /语义覆盖由 Agent 核对、人工审阅/);
  assert.match(parent, /覆盖：R2、R3/);
  assert.match(child, /覆盖：父 preflight 的 R2、R3/);
  for (const template of [parent, child]) {
    assert.match(template, /R 编号.*不能替代任务编号或依赖/);
    assert.match(template, /<!-- falla-tasks-format: 1 -->/);
    assert.match(template, /- \[ \] 2\.1 .*依赖：1\.1/);
  }
});

test('行为覆盖仍由 Agent 与人工核对，旧进度不因正文编号或排版自动失效', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const propose = await read('skill-spec/[架构必读]propose.md');
  assert.match(preflight, /已有记录不因缺少 R 编号而自动失效/);
  assert.match(preflight, /不自动重写旧 preflight 或重编已开始的 tasks/);
  assert.match(preflight, /程序只检查现有格式和准入.*不证明自然语言分析质量或行为覆盖完整性/s);
  assert.match(propose, /不靠改排版刷新基线/);
  assert.match(propose, /Apply 仍每轮只推进一个 task.*等待用户回复“继续”/);
});

test('Preflight 规则允许有范围依据且影响完成条件的必要边界缺口', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  assert.match(preflight, /本次需求、已核实的接口契约、明确的平台约束或当前实现路径/);
  assert.match(preflight, /影响本次完成条件的必要边界/);
  assert.match(preflight, /新增功能没有源码.*缺少产品决定.*待确认/s);
  assert.doesNotMatch(preflight, /只核对方法主干|只有 PRD 明确要求或源码已证实的问题才记录/);
});

test('Preflight 必要边界规则保留有界分析且不替产品选择行为', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  assert.match(preflight, /不套通用清单、不无限枚举/);
  assert.match(preflight, /不预设生命周期或 NPE 检查清单/);
  assert.match(preflight, /范围依据、触发条件、缺少的决定、影响和待确认项/);
  assert.match(preflight, /不自行选择默认值、重试、兜底、弹窗或降级方案/);
  assert.match(preflight, /资源所有权、页面销毁后回调.*可核实.*工程约束/s);
  assert.match(preflight, /不把.*取消业务请求.*当作工程惯例/s);
  assert.match(preflight, /只读调查可以继续/);
});

test('Preflight 问题模板容纳必要边界并只记录缺口而非自选方案', async () => {
  const template = await read('openspec/schemas/falla-spec-driven/templates/preflight.md');
  assert.match(template, /检查维度：主干 \/ 兼容差额 \/ 必要边界/);
  assert.match(template, /范围依据：/);
  assert.match(template, /触发条件（必要边界填写）：/);
  assert.match(template, /缺少的决定或冲突点：/);
  assert.doesNotMatch(template, /可选方案：/);
  assert.match(template, /阻塞项编号.*顶部台账/);
});

test('生命周期与资源释放只在代码完成后集中检查，必要缺口交人工', async () => {
  const preflight = await read('skill-spec/[分析必读]preflight.md');
  const quality = await read('skill-spec/references/android-quality.md');
  const parentPreflight = await read('openspec/schemas/falla-spec-driven/templates/preflight.md');
  const source = await readFile('src/coordination/comate.js', 'utf8');

  assert.match(preflight, /不预设生命周期或 NPE 检查清单/);
  assert.doesNotMatch(parentPreflight, /退出安全/);
  assert.match(quality, /页面没有需要主动释放的资源时记/);
  assert.match(quality, /按整个 change 的最终代码判断所有权/);
  assert.match(quality, /Adapter\/ItemView 常规复用只复位绑定状态，不做整页式 `destroy`/);
  assert.match(quality, /确实自行持有播放器、计时器或/);
  assert.match(quality, /已负责取消其协程时不重复手动取消/);
  assert.match(quality, /按其真实持有者和使用边界成对 `remove`\/`unregister`/);
  assert.match(quality, /不强清 Glide\/Coil 等图片框架的全局缓存/);
  assert.match(quality, /多 Flavor 项目使用已核实的精确变体任务/);
  assert.match(quality, /:app:assembleDemoDebug/);
  assert.doesNotMatch(source, /'生命周期结论'/);
});

test('日常任务轻量检查，集成时构建 APK 并保留失败证据', async () => {
  const quality = await read('skill-spec/references/android-quality.md');
  const coordination = await read('skill-spec/references/coordination.md');

  assert.match(quality, /package<Variant>Resources/);
  assert.match(quality, /assemble<Variant>/);
  assert.match(quality, /不能单独证明\s*AAPT 通过/);
  assert.match(quality, /库模块 AAR 不能替代 APK/);
  assert.match(quality, /不要求每次修改 XML\/资源或 Kotlin\/Java 后都运行 Gradle/);
  assert.match(quality, /成功已覆盖依赖模块的资源打包和代码编译/);
  assert.match(coordination, /恢复未完成/);
  assert.match(coordination, /先通知各 owner，按逆依赖/);
  // 父恢复的运行行为由 parent-coordinator 集成回归覆盖，不再锁定旧手工回退措辞。
  assert.match(coordination, /已归档 change 不原地重开/);
});

test('UI Knowledge 先筛硬条件，仅多方案时可选评分', async () => {
  const knowledge = await read('skill-spec/references/ui-knowledge.md');
  const design = await read('openspec/schemas/falla-spec-driven/templates/design.md');

  assert.match(knowledge, /通过校验的 draft\s*\| 仅 `reference-only`/);
  assert.match(knowledge, /证据过期（`stale-evidence`）\s*\| `rejected`，修复指纹并重新验证前不得引用/);
  assert.match(knowledge, /默认不对每个控件打分/);
  assert.match(knowledge, /分数辅助讨论，硬条件优先/);
  assert.match(design, /UI Knowledge 选型/);
  assert.match(design, /交付验证边界/);
});

test('唯一合格复用候选和用户指定组件写入 required 并由 Apply 核对落地', async () => {
  const knowledge = await read('skill-spec/references/ui-knowledge.md');

  assert.match(knowledge, /唯一.*必须.*复用/s);
  assert.match(knowledge, /用户明确指定.*必须.*使用/s);
  assert.match(knowledge, /draft.*reference-only/s);
  assert.match(knowledge, /不默认请求人工裁决/);
});

test('Apply 每轮只执行一个 task，下一项等待用户明确确认', async () => {
  const soul = await read('skill-spec/[Must Read]soul.md');
  const coordination = await read('skill-spec/references/coordination.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const skill = await read('skills/falla-apply-change/SKILL.md');
  const metadata = await read('skills/falla-apply-change/agents/openai.yaml');
  assert.match(soul, /一次只完成一个 task.*停下汇报.*用户明确确认/s);
  assert.match(coordination, /每轮.*只推进一个 ready task/s);
  assert.match(coordination, /验证后立即勾选并更新\s+handoff/s);
  assert.match(coordination, /不得提前勾选或批量补勾/);
  assert.match(coordination, /agent 不得含人工任务/);
  assert.match(coordination, /done 要求全部 tasks 完成/);
  assert.match(apply, /状态落盘后，重新读取 instructions\/tasks/);
  assert.match(coordination, /强耦合任务.*返回 Propose.*合并/s);
  assert.doesNotMatch([soul, coordination, apply, skill, metadata].join('\n'), /不可分双 task|不可分的两项|不可分的两个|inseparable pair|合并的不可分/);
  assert.match(coordination, /用户.*回复“继续”.*无需重新调用 Apply/s);
  assert.match(apply, /下一个候选.*停止.*回复“继续”.*无需重新调用 Apply/s);
  assert.match(skill, /下一个候选.*停止.*回复“继续”.*无需重新调用 Apply/s);
  assert.match(metadata, /implement one task, report and pause/);
  assert.match(skill, /恢复时.*第 3–5 步复核.*不直接执行上轮.*候选/s);
  assert.doesNotMatch(apply, /须由用户再次手动调用 Apply/);
  assert.doesNotMatch(skill, /须由用户再次手动调用 Apply/);
  assert.doesNotMatch(apply, /再选择下一个 ready task/);
  assert.doesNotMatch(skill, /再选择下一个 ready task/);
});

test('OpenSpec 特殊语义仍保留在对应权威入口', async () => {
  const propose = await read('skill-spec/[架构必读]propose.md');
  const skill = await read('skills/falla-propose/SKILL.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  const archive = await read('skills/falla-archive-change/SKILL.md');
  assert.match(propose, /skip_specs: true/);
  assert.match(skill, /允许数字开头/);
  assert.match(apply, /operationGuidance/);
  assert.match(archive, /retire_capabilities: true/);
  assert.match(archive, /--no-validate/);
  assert.match(archive, /--skip-specs/);
  assert.match(archive, /不得使用 `--force`、`--skip-validate`/);
});

test('归档门禁在 single、parallel 父和逻辑/物理子 change 中统一强制加载并执行', async () => {
  const phase = await read('skill-spec/[任务选读]archive.md');
  const skill = await read('skills/falla-archive-change/SKILL.md');
  const coordination = await read('skill-spec/references/coordination.md');
  assert.match(phase, /所有模式.*必须.*references\/coordination\.md/su);
  assert.match(skill, /references\/coordination\.md.*强制/u);
  for (const text of [phase, skill]) {
    assert.match(text, /single、parallel 父和逻辑\/物理子 change/u);
    assert.match(text, /coordination preflight "<change>" --json/u);
    assert.match(text, /parent.*(?:返回|结果)|(?:返回|结果).*parent/u);
    assert.match(text, /falla-openspec coordination validate --change "<parent>" --json/u);
    assert.match(text, /ok.*true.*(?:退出码|exit)|(?:退出码|exit).*ok.*true/su);
    assert.doesNotMatch(text, /parallel 父 change 归档前(?:运行|执行).*coordination validate/u);
  }
  assert.match(coordination, /所有模式.*归档/u);
});

test('归档官方豁免不覆盖 Falla 错误，接受未完成告警也不能伪造 done 或人工 passed', async () => {
  const phase = await read('skill-spec/[任务选读]archive.md');
  const skill = await read('skills/falla-archive-change/SKILL.md');
  for (const text of [phase, skill]) {
    assert.match(text, /--no-validate.*(?:不|不能).*Falla/su);
    assert.match(text, /未完成告警/u);
    assert.match(text, /(?:不|不得).*done.*passed/su);
    assert.match(text, /(?:确认|等待|修改).*重新.*coordination validate/su);
  }
});
