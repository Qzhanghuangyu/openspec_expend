import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const root = path.resolve('templates');
const expectedSkills = [
  'falla-apply-change',
  'falla-archive-change',
  'falla-preflight',
  'falla-propose',
];

function parseFrontmatter(content, source) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${source} 缺少 YAML frontmatter`);
  return YAML.parse(match[1]);
}

test('四个 Skill 具备可发现的合法元数据', async () => {
  const entries = (await readdir(path.join(root, 'skills'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(entries, expectedSkills);
  for (const name of entries) {
    const skillPath = path.join(root, 'skills', name, 'SKILL.md');
    const metadata = parseFrontmatter(await readFile(skillPath, 'utf8'), skillPath);
    assert.equal(metadata.name, name);
    assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(metadata.description, /^Use when /);
  }
});

test('四个 Skill 的 OpenAI 元数据与 Skill 名称一致', async () => {
  for (const name of expectedSkills) {
    const metadataPath = path.join(root, 'skills', name, 'agents', 'openai.yaml');
    const metadata = YAML.parse(await readFile(metadataPath, 'utf8'));
    assert.equal(typeof metadata.interface.display_name, 'string');
    assert.ok(metadata.interface.short_description.length >= 10);
    assert.match(metadata.interface.default_prompt, new RegExp(`\\$${name}\\b`));
  }
});

test('规则模板使用标准 OpenSpec 路径且没有旧核心命令', async () => {
  const files = (await readdir(path.join(root, 'skill-spec'))).sort();
  assert.deepEqual(files, [
    '[Must Read]soul.md',
    '[任务选读]archive.md',
    '[分析必读]preflight.md',
    '[架构必读]propose.md',
    '[模块选读]apply.md',
  ].sort());

  const content = (await Promise.all(files.map((file) =>
    readFile(path.join(root, 'skill-spec', file), 'utf8')
  ))).join('\n');
  assert.doesNotMatch(content, /mercuryspec\//);
  assert.doesNotMatch(content, /\bfalla (?:new|list|status|instructions)\b/);
  assert.match(content, /openspec\/specs/);
  assert.match(content, /\.falla\/coordination\.yaml/);
});

test('Skill 覆盖 OpenSpec 1.12 操作上下文与 change 元数据', async () => {
  const apply = await readFile(path.join(root, 'skills', 'falla-apply-change', 'SKILL.md'), 'utf8');
  const archive = await readFile(path.join(root, 'skills', 'falla-archive-change', 'SKILL.md'), 'utf8');
  const propose = await readFile(path.join(root, 'skills', 'falla-propose', 'SKILL.md'), 'utf8');

  assert.match(apply, /operationGuidance/);
  assert.match(archive, /instructions archive/);
  assert.match(archive, /retire_capabilities: true/);
  assert.match(propose, /skip_specs: true/);
  assert.match(propose, /允许数字开头/);
});

test('Apply 阶段强制 XML 纵向格式与关键实现注释', async () => {
  const soul = await readFile(path.join(root, 'skill-spec', '[Must Read]soul.md'), 'utf8');
  const applyRule = await readFile(
    path.join(root, 'skill-spec', '[模块选读]apply.md'),
    'utf8'
  );
  const applySkill = await readFile(
    path.join(root, 'skills', 'falla-apply-change', 'SKILL.md'),
    'utf8'
  );
  const parentSchema = await readFile(
    path.join(root, 'openspec', 'schemas', 'falla-spec-driven', 'schema.yaml'),
    'utf8'
  );
  const childSchema = await readFile(
    path.join(root, 'openspec', 'schemas', 'falla-task-driven', 'schema.yaml'),
    'utf8'
  );

  for (const [source, content] of [
    ['soul', soul],
    ['apply rule', applyRule],
    ['apply skill', applySkill],
    ['parent schema', parentSchema],
    ['child schema', childSchema],
  ]) {
    assert.match(content, /Android XML/, `${source} 缺少 Android XML 约束`);
    assert.match(content, /属性逐行/, `${source} 缺少 XML 属性逐行要求`);
    assert.match(content, /类.*方法.*参数/s, `${source} 缺少类、方法和参数注释要求`);
    assert.match(content, /KDoc\/JavaDoc/, `${source} 缺少方法文档格式要求`);
    assert.match(content, /参数.*业务含义.*可空性/s, `${source} 缺少参数语义要求`);
    assert.match(content, /线程.*生命周期/s, `${source} 缺少线程与生命周期说明要求`);
    assert.match(content, /只格式化.*change/s, `${source} 缺少最小格式化边界`);
  }

  assert.match(soul, /方法参数使用 `@param`/);
  assert.match(soul, /简单 override、getter\/setter/);
  assert.match(soul, /不得把 PRD、operationGuidance、凭据或.*敏感正文/s);
  assert.match(applyRule, /禁止用逐行翻译代码、重复名称或类型的噪声注释凑数/);
  assert.match(applySkill, /formatter、lint、资源编译或等价检查/);
});

test('设计稿链接在所有阶段强制使用专用 MCP 且禁止浏览器降级', async () => {
  const soul = await readFile(path.join(root, 'skill-spec', '[Must Read]soul.md'), 'utf8');
  assert.match(soul, /此门禁适用于 preflight、propose、apply、archive 以及任意中间阶段/);
  assert.match(soul, /PRD 正文中内嵌或引用的设计稿链接不读取、不自动跟随/);
  assert.match(soul, /只有用户在当前对话中另行手动提供/);
  assert.match(soul, /链接必须包含明确的 node id/);
  assert.match(soul, /缺少 node id 时请求用户重新选择目标节点并复制链接/);
  assert.match(soul, /必须使用 Figma MCP/);
  assert.match(soul, /不得使用浏览器、\n  Chrome、WebFetch、`curl`、网页截图或 DOM 抓取/);
  assert.match(soul, /浏览器不是 Figma MCP 的降级方案/);
  assert.match(soul, /get_design_context.*excludeScreenshot=true/s);
  assert.match(soul, /不得调用 `get_screenshot`/);
  assert.match(soul, /不得把截图、截图 URL、图片块/);
  assert.match(soul, /临时资源 URL、认证信息、cookie、token/);
  assert.match(soul, /避免沿用过期\n  截图或缓存造成实现与设计生命周期不一致/);

  for (const file of [
    '[分析必读]preflight.md',
    '[架构必读]propose.md',
    '[模块选读]apply.md',
    '[任务选读]archive.md',
  ]) {
    const phaseRule = await readFile(path.join(root, 'skill-spec', file), 'utf8');
    assert.match(
      phaseRule,
      /get_design_context.*excludeScreenshot=true/s,
      `${file} 缺少截图排除参数`
    );
    assert.match(phaseRule, /禁止调用 `get_screenshot`/, `${file} 缺少截图工具禁令`);
  }

  const preflightRule = await readFile(
    path.join(root, 'skill-spec', '[分析必读]preflight.md'),
    'utf8'
  );
  assert.match(preflightRule, /不得读取或自动跟随 PRD 正文中的/);
  assert.match(preflightRule, /另行手动提供含明确 node id/);
  assert.match(preflightRule, /Figma 链接只用 Figma MCP 读取/);
  assert.match(preflightRule, /不得用浏览器查看/);

  for (const name of expectedSkills) {
    const content = await readFile(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(content, /Figma 链接只用 Figma MCP 读取/, `${name} 缺少 Figma MCP 门禁`);
    assert.match(content, /浏览器降级/, `${name} 缺少浏览器降级禁令`);
    assert.match(content, /excludeScreenshot=true/, `${name} 缺少文本模型截图排除参数`);
    assert.match(content, /get_screenshot/, `${name} 缺少截图工具禁令`);
  }
});


test('Preflight 默认只核对当前实现且禁止重复读取 Git 历史', async () => {
  const rule = await readFile(path.join(root, 'skill-spec', '[分析必读]preflight.md'), 'utf8');
  const skill = await readFile(path.join(root, 'skills', 'falla-preflight', 'SKILL.md'), 'utf8');
  const schema = await readFile(
    path.join(root, 'openspec', 'schemas', 'falla-spec-driven', 'schema.yaml'),
    'utf8'
  );

  for (const content of [rule, skill]) {
    assert.match(content, /默认禁止.*`git log`/s);
    assert.match(content, /只有用户明确要求分析变更沿革、回归来源或具体提交时/);
    assert.match(content, /有界批量查询/);
    assert.match(content, /不得.*重复/s);
  }
  assert.match(rule, /“历史版本兼容”指客户端、数据、接口或运行时版本兼容/);
  assert.match(rule, /`git status --short`/);
  assert.match(schema, /默认禁止读取 git log\/show\/blame\/reflog\/rev-list/);
  assert.match(schema, /不得重复或全仓扫描/);
});



test('Propose 默认单 change 且仅在用户明确要求时创建并行子 change', async () => {
  const soul = await readFile(path.join(root, 'skill-spec', '[Must Read]soul.md'), 'utf8');
  const proposeRule = await readFile(
    path.join(root, 'skill-spec', '[架构必读]propose.md'),
    'utf8'
  );
  const applyRule = await readFile(
    path.join(root, 'skill-spec', '[模块选读]apply.md'),
    'utf8'
  );
  const proposeSkill = await readFile(
    path.join(root, 'skills', 'falla-propose', 'SKILL.md'),
    'utf8'
  );
  const applySkill = await readFile(
    path.join(root, 'skills', 'falla-apply-change', 'SKILL.md'),
    'utf8'
  );
  const schema = await readFile(
    path.join(root, 'openspec', 'schemas', 'falla-spec-driven', 'schema.yaml'),
    'utf8'
  );

  for (const content of [soul, proposeRule, proposeSkill, schema]) {
    assert.match(content, /single/);
    assert.match(content, /parallel/);
    assert.match(content, /用户明确要求/);
  }
  assert.match(soul, /任务拆解与 change 拆解是两件事/);
  assert.match(proposeRule, /不调用 `coordination register`/);
  assert.match(proposeSkill, /不创建额外 change 目录/);
  assert.match(proposeSkill, /任务较多、存在 MVVM\s+分层或理论上可并行/);
  assert.match(applyRule, /不在此阶段拆分、创建 change 或切换执行模式/);
  assert.match(applySkill, /single：直接实施父 change/);
  assert.match(applySkill, /已有当前父 change 的映射则沿用 `parallel`/);
});

test('新页面在 Propose 固化实现结构基线并由 Apply 执行前置校验', async () => {
  const proposeRule = await readFile(
    path.join(root, 'skill-spec', '[架构必读]propose.md'),
    'utf8'
  );
  const applyRule = await readFile(
    path.join(root, 'skill-spec', '[模块选读]apply.md'),
    'utf8'
  );
  const proposeSkill = await readFile(
    path.join(root, 'skills', 'falla-propose', 'SKILL.md'),
    'utf8'
  );
  const applySkill = await readFile(
    path.join(root, 'skills', 'falla-apply-change', 'SKILL.md'),
    'utf8'
  );
  const schema = await readFile(
    path.join(root, 'openspec', 'schemas', 'falla-spec-driven', 'schema.yaml'),
    'utf8'
  );

  for (const content of [proposeRule, proposeSkill, schema]) {
    assert.match(content, /页面实现结构基线/);
    assert.match(content, /XML \/ Compose/);
    assert.match(content, /最小可编译/);
  }
  for (const content of [applyRule, applySkill]) {
    assert.match(content, /页面实现结构基线/);
    assert.match(content, /返回 propose 修正/);
  }
});

test('长任务使用 tasks 和 comate 滚动检查点恢复上下文', async () => {
  const soul = await readFile(path.join(root, 'skill-spec', '[Must Read]soul.md'), 'utf8');
  const proposeRule = await readFile(
    path.join(root, 'skill-spec', '[架构必读]propose.md'),
    'utf8'
  );
  const applyRule = await readFile(
    path.join(root, 'skill-spec', '[模块选读]apply.md'),
    'utf8'
  );
  const proposeSkill = await readFile(
    path.join(root, 'skills', 'falla-propose', 'SKILL.md'),
    'utf8'
  );
  const applySkill = await readFile(
    path.join(root, 'skills', 'falla-apply-change', 'SKILL.md'),
    'utf8'
  );

  for (const content of [soul, proposeRule, proposeSkill]) {
    assert.match(content, /一次独立实施上下文/);
    assert.match(content, /拆 task/);
  }
  for (const content of [soul, applyRule, applySkill]) {
    assert.match(content, /滚动检查点/);
    assert.match(content, /git status --short/);
    assert.match(content, /当前源码与官方状态/);
    assert.match(content, /不依赖对话记忆|对话上下文和自动摘要不是事实源/);
  }
});

test('全局规则要求使用 CodeGraph 做有界代码定位并保留文本搜索兜底', async () => {
  const soul = await readFile(path.join(root, 'skill-spec', '[Must Read]soul.md'), 'utf8');
  const preflight = await readFile(path.join(root, 'skills', 'falla-preflight', 'SKILL.md'), 'utf8');

  assert.match(soul, /任务开始前由 Hook 初始化或增量同步/);
  assert.match(soul, /优先使用 CodeGraph/);
  assert.match(soul, /不得把完整 CodeGraph 数据库、全量图谱结果或无关源码注入上下文/);
  assert.match(soul, /生命周期代码的核对/);
  assert.match(preflight, /CodeGraph 验证其源码符号、调用链和影响面/);
  assert.match(preflight, /CodeGraph 不可用时允许有界降级/);
});


test('UI 知识协议保持项目隔离并连接 RAG 与 CodeGraph', async () => {
  const soul = await readFile(path.join(root, 'skill-spec', '[Must Read]soul.md'), 'utf8');
  const knowledge = await readFile(path.resolve('templates/ui-knowledge/README.md'), 'utf8');
  const schema = await readFile(path.resolve('templates/ui-knowledge/schema-v1.md'), 'utf8');
  const config = YAML.parse(await readFile(
    path.resolve('templates/ui-knowledge/config.example.yaml'),
    'utf8'
  ));
  const componentPath = path.resolve('templates/ui-knowledge/templates/component.md');
  const screenPath = path.resolve('templates/ui-knowledge/templates/screen-pattern.md');
  const component = await readFile(componentPath, 'utf8');
  const screen = await readFile(screenPath, 'utf8');
  const componentMetadata = parseFrontmatter(component, componentPath);
  const screenMetadata = parseFrontmatter(screen, screenPath);
  const combined = [soul, knowledge, schema, component, screen].join('\n');

  assert.match(soul, /项目独立维护的 UI 组件知识库/);
  assert.match(soul, /禁止自动读取、召回、合并或复制其他项目/);
  assert.match(soul, /Markdown 是唯一知识事实源/);
  assert.match(knowledge, /工作流受管文件只有 README、Schema、配置示例和空白模板/);
  assert.match(knowledge, /默认禁止读取、召回、合并或复制其他项目/);
  assert.match(knowledge, /RAG.*模糊召回.*CodeGraph.*验证/s);
  assert.match(schema, /scope.*V1 必须是 `project`/s);
  assert.equal(config.scope, 'project');
  assert.equal(config.retrieval.projectOnly, true);
  assert.equal(config.semantic.indexPath, '.falla/ui-knowledge/.index');
  assert.equal(config.writeback.autoGenerate, false);
  assert.equal(componentMetadata['schema-version'], 1);
  assert.equal(componentMetadata.scope, 'project');
  assert.equal(componentMetadata.kind, 'component');
  assert.equal(componentMetadata.status, 'draft');
  assert.equal(typeof componentMetadata.codegraph['primary-symbol'], 'string');
  assert.equal(screenMetadata.kind, 'screen-pattern');
  assert.equal(screenMetadata.scope, 'project');
  assert.match(component, /async\/observer lifecycle/);
  assert.match(screen, /direct reuse conditions/);
  assert.doesNotMatch(combined, /androidCopy|\/Users\/|\/home\//);
  assert.doesNotMatch(combined, /自动创建.*具体项目|跨项目共享数据库/);
});
