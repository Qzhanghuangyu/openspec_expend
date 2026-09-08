import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { makeLegacyProject } from '../helpers/legacy-project.js';
import { planMigration } from '../../src/migration/planner.js';
import { renderMigrationReport } from '../../src/migration/report.js';
import { scanLegacyProject } from '../../src/migration/scanner.js';

test('计划展开 active/archive 子 change、保留附件并生成逻辑映射', async () => {
  const root = await makeLegacyProject();
  const plan = await planMigration(root, await scanLegacyProject(root));

  assert.equal(plan.mappings['medal/detail'].physical, 'medal-child-detail');
  assert.equal(plan.mappings['profile/avatar'].physical, 'profile-child-avatar');
  assert.ok(plan.operations.some((operation) =>
    operation.from === 'mercuryspec/changes/medal/changes/detail/figma/node.json'
    && operation.to === 'openspec/changes/medal-child-detail/figma/node.json'));
  assert.ok(plan.operations.some((operation) =>
    operation.to === 'openspec/changes/archive/2026-07-20-profile-child-avatar/tasks.md'));
});

test('计划分流工作流规则、保留目标默认 Schema 并转换自定义 Schema', async () => {
  const root = await makeLegacyProject();
  const plan = await planMigration(root, await scanLegacyProject(root));

  assert.equal(plan.operations.some((operation) =>
    operation.to?.startsWith('openspec/specs/[Must Read]')), false);
  assert.ok(plan.operations.some((operation) =>
    operation.from === 'mercuryspec/specs/[Must Read]soul.md'
    && operation.kind === 'skip'));
  assert.ok(plan.operations.some((operation) =>
    operation.to === 'openspec/schemas/custom/templates/tasks.md'));
  const configOperation = plan.operations.find((operation) => operation.to === 'openspec/config.yaml');
  assert.equal(configOperation.kind, 'skip');
  assert.equal(configOperation.reason, 'target-config-preserved');
});

test('安全报告不包含文档正文或生成内容', async () => {
  const root = await makeLegacyProject();
  const plan = await planMigration(root, await scanLegacyProject(root));
  const report = renderMigrationReport(plan);
  const text = JSON.stringify(report);

  assert.doesNotMatch(text, /Chat capability|CURRENT_FALLA_RULE|# Tasks/);
  assert.ok(report.counts.copy > 0);
  assert.ok(report.counts.write > 0);
  assert.ok(report.operations.every((operation) => !Object.hasOwn(operation, 'content')));
});

test('dry-run 汇总目标冲突而不是在第一个冲突处中断', async () => {
  const root = await makeLegacyProject();
  await mkdir(path.join(root, 'openspec', 'specs', 'chat'), { recursive: true });
  await writeFile(path.join(root, 'openspec', 'specs', 'chat', 'spec.md'), 'different\n');
  await writeFile(path.join(root, 'openspec', 'specs', 'chat', 'notes.md'), 'also different\n');

  const plan = await planMigration(root, await scanLegacyProject(root));
  const conflicts = plan.operations.filter(({ kind }) => kind === 'conflict');
  assert.deepEqual(conflicts.map(({ to }) => to).sort(), [
    'openspec/specs/chat/notes.md',
    'openspec/specs/chat/spec.md',
  ]);
  assert.equal(renderMigrationReport(plan).counts.conflict, 2);
});

test('config 和 coordination 采用带目标哈希前置条件的结构化合并', async () => {
  const root = await makeLegacyProject();
  await writeFile(path.join(root, 'mercuryspec', 'config.yaml'), 'schema: spec-driven\ncontext: legacy-context\n');
  await writeFile(path.join(root, '.falla', 'coordination.yaml'), `version: 1
mappings:
  existing/child:
    physical: existing-child-child
    parent: existing
`);

  const plan = await planMigration(root, await scanLegacyProject(root));
  const config = plan.operations.find(({ to }) => to === 'openspec/config.yaml');
  const coordination = plan.operations.find(({ to }) => to === '.falla/coordination.yaml');

  assert.equal(config.kind, 'write');
  assert.match(config.expectedTargetHash, /^[a-f0-9]{64}$/);
  assert.match(config.content, /schema: custom-default/);
  assert.match(config.content, /context: legacy-context/);
  assert.equal(coordination.kind, 'write');
  assert.match(coordination.expectedTargetHash, /^[a-f0-9]{64}$/);
  assert.match(coordination.content, /existing\/child/);
  assert.match(coordination.content, /medal\/detail/);
});
