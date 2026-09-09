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
