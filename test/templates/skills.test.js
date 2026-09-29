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
  assert.match(design, /未取得 \/ 待人工校准/);
  assert.match(quality, /## UI 文本核对与视觉边界/);
  assert.match(quality, /View 层级或 Compose 语义树/);
  assert.match(quality, /不能把设备物理 px 与 dp 直接相减/);
  assert.match(quality, /不把完整层级、真实业务数据或截图写进 handoff/);
  assert.match(quality, /不要求向模型上传图片/);
});

test('Figma 用图仅复用成品或原生导出，透明新 PNG 验收后才可交付', async () => {
  const rules = await read('skill-spec/references/design-tools.md');

  assert.match(rules, /看图（理解设计）与用图（交付资源）是两条管线/);
  assert.match(rules, /`rawImages` 是原始图片，`export` 是节点渲染结果/);
  assert.match(rules, /原生 Export/);
  assert.match(rules, /`png` 或 `svg`/);
  assert.match(rules, /`scale=3` 对应 xxhdpi/);
  assert.match(rules, /`sips -g hasAlpha <file>`.*`hasAlpha: yes`/);
  assert.match(rules, /已有正式资源\/成品原图不强制新增 Alpha/);
  assert.match(rules, /MCP 无原生导出能力时，须先取得用户.*REST 降级授权/);
  assert.match(rules, /临时资源 URL 仅可通过批准的二进制下载方式/);
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
  assert.match(coordination, /父 owner 将父 `done` 同步恢复/);
  assert.match(coordination, /已归档 change 不原地重开/);
});

test('UI Knowledge 先筛硬条件，仅多方案时可选评分', async () => {
  const knowledge = await read('skill-spec/references/ui-knowledge.md');
  const design = await read('openspec/schemas/falla-spec-driven/templates/design.md');

  assert.match(knowledge, /通过校验的 draft 仅 `reference-only`/);
  assert.match(knowledge, /证据过期（`stale-evidence`）按校验结果 `rejected`/);
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

test('任务循环与完成门禁由 coordination 定义，Apply 负责阶段循环', async () => {
  const coordination = await read('skill-spec/references/coordination.md');
  const apply = await read('skill-spec/[模块选读]apply.md');
  assert.match(coordination, /一次只推进一个 ready task/);
  assert.match(coordination, /验证后立即勾选并更新 handoff/);
  assert.match(coordination, /不得提前勾选或批量补勾/);
  assert.match(coordination, /agent 不得含人工任务/);
  assert.match(coordination, /done 要求全部 tasks 完成/);
  assert.match(apply, /状态落盘后重新读取 instructions\/tasks/);
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
