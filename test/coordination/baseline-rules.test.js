import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import { readBaselineFields } from '../../src/coordination/baseline.js';

const read = file => readFile(file, 'utf8');

test('父子 comate 保留旧格式版本并显式留待核验，schema 指令不把更新 hash 当验证', async () => {
  for (const schema of ['falla-spec-driven', 'falla-task-driven']) {
    const template = await read(`templates/openspec/schemas/${schema}/templates/comate.md`);
    assert.match(template, /format-version\): 2/u);
    assert.deepEqual(readBaselineFields(template), { snapshot: null, review: null });
    const definition = YAML.parse(await read(`templates/openspec/schemas/${schema}/schema.yaml`));
    assert.match(definition.artifacts.find(item => item.id === 'comate').instruction, /旧进度不得直接刷新/u);
    assert.match(definition.apply.instruction, /all_done 不证明完成证据仍适用/u);
  }
});

test('权威规则明确需求/方案修订路由、局部回退和记录所有权，Apply all_done 同样检查基线', async () => {
  const coordination = await read('templates/skill-spec/references/coordination.md');
  const propose = await read('templates/skill-spec/[架构必读]propose.md');
  const apply = await read('templates/skill-spec/[模块选读]apply.md');
  const preflight = await read('templates/skill-spec/[分析必读]preflight.md');
  const skill = await read('templates/skills/falla-apply-change/SKILL.md');
  for (const text of [coordination, propose, apply, preflight]) assert.match(text, /Preflight/u);
  for (const term of ['不自动撤销全部进度', 'affected', 'preserved', '不能更新父指纹来替子通过', '不自动重编', '已确认需求']) {
    assert.ok(coordination.includes(term), term);
  }
  assert.match(propose, /不从模板重建 comate\/tasks/u);
  assert.match(apply, /all_done.*基线/u);
  assert.match(skill, /coordination baseline/u);
  assert.match(skill, /不直接刷新指纹/u);
});
