import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const root = path.resolve('templates');
const read = relative => readFile(path.join(root, relative), 'utf8');
const phases = {
  'falla-preflight': '[分析必读]preflight.md',
  'falla-propose': '[架构必读]propose.md',
  'falla-apply-change': '[模块选读]apply.md',
  'falla-archive-change': '[任务选读]archive.md',
};

test('Skill 只通过必读阶段入口加载政策，不能再内联设计和人工验收细则', async () => {
  for (const [skill, phase] of Object.entries(phases)) {
    const text = await read(`skills/${skill}/SKILL.md`);
    assert.ok(text.includes(`.falla/skill-spec/${phase}`));
    assert.match(text, /未注入或无法确认时再读取/);
    assert.doesNotMatch(text, /哈希|Alpha|生命周期条件|human-review 为|human-review.*not-required|长评论 ID/);
  }
});

test('Schema 保留 DAG 和产物契约，通过阶段规则引入操作政策', async () => {
  for (const name of ['falla-spec-driven', 'falla-task-driven']) {
    const schema = YAML.parse(await read(`openspec/schemas/${name}/schema.yaml`));
    assert.deepEqual(schema.apply.requires, ['comate']);
    assert.equal(schema.apply.tracks, 'tasks.md');
    assert.match(schema.apply.instruction, /\.falla\/skill-spec\/\[模块选读\]apply.md/);
    for (const artifact of schema.artifacts) {
      assert.match(artifact.instruction, /\.falla\/skill-spec\//, artifact.id);
      assert.doesNotMatch(artifact.instruction, /Alpha|AutoSizeConfig|sips|human-review 可为|多个可行.*评分/);
      await read(`openspec/schemas/${name}/templates/${artifact.template}`);
    }
  }
});

test('所有安装规则引用可解析，阶段路由显式要求加载对应权威细则', async () => {
  const soul = await read('skill-spec/[Must Read]soul.md');
  assert.match(soul, /规则权威位置/);
  const references = await readdir(path.join(root, 'skill-spec/references'));
  for (const phase of Object.values(phases)) {
    const content = await read(`skill-spec/${phase}`);
    for (const match of content.matchAll(/references\/([a-z-]+\.md)/g)) {
      assert.ok(references.includes(match[1]), `${phase}: ${match[1]} 不存在`);
    }
  }
  for (const phase of ['[架构必读]propose.md', '[模块选读]apply.md']) {
    const content = await read(`skill-spec/${phase}`);
    assert.match(content, /必读 `references\/project-rules.md`/);
    assert.match(content, /必读 `references\/coordination.md`/);
    for (const name of ['android-quality', 'design-tools', 'ui-knowledge']) {
      assert.ok(content.includes(`必须读取 \`references/${name}.md\``));
    }
  }
});

test('Skill、Schema 和模板的权威路径全部指向随包分发的规则文件', async () => {
  async function walk(directory) {
    const files = [];
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await walk(relative));
      else if (/\.(?:md|yaml)$/.test(entry.name)) files.push(relative);
    }
    return files;
  }
  for (const source of [...await walk('skills'), ...await walk('openspec/schemas')]) {
    const text = await read(source);
    for (const match of text.matchAll(/\.falla\/skill-spec\/(references\/[a-z-]+\.md|\[[^\]\n]+\][a-z]+\.md)/g)) {
      assert.ok((await read(`skill-spec/${match[1]}`)).trim(), `${source}: ${match[1]}`);
    }
  }
});
