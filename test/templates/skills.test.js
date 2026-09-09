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
  assert.match(soul, /临时资源 URL、认证信息、cookie、token/);
  assert.match(soul, /避免沿用过期\n  截图或缓存造成实现与设计生命周期不一致/);

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
