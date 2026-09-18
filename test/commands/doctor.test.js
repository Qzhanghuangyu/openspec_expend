import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { doctorProject } from '../../src/commands/doctor.js';
import { installProject } from '../../src/commands/install.js';
import { sha256 } from '../../src/install/files.js';

const execFileAsync = promisify(execFile);

async function createOpenSpecProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-openspec-doctor-'));
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  return root;
}

test('doctor 只读报告官方版本、项目和未安装扩展', async () => {
  const root = await createOpenSpecProject();
  const report = await doctorProject({ root });

  assert.equal(report.openSpec.version, '1.12.0');
  assert.equal(report.openSpec.supportedRange, '>=1.12.0 <1.13.0');
  assert.equal(report.project.initialized, true);
  assert.equal(report.schemas.installed, 0);
  assert.equal(report.install.manifest, false);
  assert.equal(report.coordination.present, false);
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.id === 'openspec-list' && check.ok), true);
});

test('doctor 报告不包含环境变量、规格正文或项目绝对路径', async () => {
  const root = await createOpenSpecProject();
  const reportText = JSON.stringify(await doctorProject({ root }));

  assert.doesNotMatch(reportText, /processEnv|documentBody|OPENAI_API_KEY/);
  assert.doesNotMatch(reportText, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('doctor 校验官方 Schema、manifest/Hook 哈希和用户修改漂移', async () => {
  const root = await createOpenSpecProject();
  await installProject({ root, tools: ['claude', 'codex'], interactive: false });
  const healthy = await doctorProject({ root });

  assert.equal(healthy.ok, true);
  assert.equal(healthy.checks.some(({ id, ok }) => id === 'falla-schema-validation' && ok), true);
  assert.equal(healthy.checks.some(({ id, ok }) => id === 'falla-install-integrity' && ok), true);

  const skillPath = path.join(root, '.codex', 'skills', 'falla-preflight', 'SKILL.md');
  const originalSkill = await readFile(skillPath);
  await writeFile(skillPath, 'user drift\n');
  const drifted = await doctorProject({ root });
  const integrity = drifted.checks.find(({ id }) => id === 'falla-install-integrity');
  assert.equal(drifted.ok, false);
  assert.equal(integrity.ok, false);
  assert.deepEqual(integrity.paths, ['.codex/skills/falla-preflight/SKILL.md']);
  assert.doesNotMatch(JSON.stringify(drifted), /user drift/);

  await writeFile(skillPath, originalSkill);
  const agentsPath = path.join(root, 'AGENTS.md');
  const agents = await readFile(agentsPath, 'utf8');
  await writeFile(agentsPath, `${agents}\n用户自有规则\n`);
  assert.equal((await doctorProject({ root })).ok, true);

  await writeFile(
    agentsPath,
    agents.replace('FallaOpenSpec Skill 约束', '已修改的 FallaOpenSpec Skill 约束')
  );
  const hookDrift = await doctorProject({ root });
  assert.deepEqual(
    hookDrift.checks.find(({ id }) => id === 'falla-install-integrity').paths,
    ['AGENTS.md']
  );
});

test('doctor 拒绝 manifest 哈希一致但绑定旧项目根的 Codex Hook', async () => {
  const root = await createOpenSpecProject();
  await installProject({ root, tools: ['codex'], interactive: false });
  const configPath = path.join(root, '.codex', 'config.toml');
  const portableConfig = await readFile(configPath, 'utf8');
  const portableCommandLine = portableConfig.match(/^command = .+$/m);
  assert.ok(portableCommandLine);
  const legacyCommand = `node '${root}/.codex/hooks/falla-spec-session.mjs'`;
  const legacyConfig = portableConfig.replace(
    /^command = .+$/m,
    `command = ${JSON.stringify(legacyCommand)}`
  ).replace(
    '# falla-spec-session:end',
    `# ${portableCommandLine[0]}\n# falla-spec-session:end`
  );
  await writeFile(configPath, legacyConfig);

  const marker = legacyConfig.match(
    /# falla-spec-session:start[\s\S]*# falla-spec-session:end/
  );
  assert.ok(marker);
  const manifestPath = path.join(root, '.falla', 'install-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files['.codex/config.toml'] = sha256(marker[0]);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const report = await doctorProject({ root });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.checks.find(({ id }) => id === 'falla-install-integrity').paths,
    ['.codex/config.toml']
  );
});

test('doctor 区分安装完整性、single 状态和非法知识，安装更新仍可完成', async () => {
  const root = await createOpenSpecProject();
  await installProject({ root, tools: ['codex'], interactive: false });
  await execFileAsync('openspec', ['new', 'change', 'health-test', '--schema', 'falla-spec-driven', '--json'], { cwd: root });
  const change = path.join(root, 'openspec/changes/health-test');
  await writeFile(path.join(change, 'tasks.md'), '- [ ] 1.1 pending\n');
  await writeFile(path.join(change, 'comate.md'), '# comate\n- 负责人 (owner): unassigned\n- 状态 (status): done\n- 依赖 (depends-on): []\n- 被依赖 (blocks): []\n- 交接 (handoff):\n');
  const knowledge = path.join(root, '.falla/ui-knowledge/components');
  await mkdir(knowledge, { recursive: true });
  await writeFile(path.join(knowledge, 'bad.md'), '---\nschema-version: 999\nscope: other\n---\nPRIVATE_BODY');
  const result = await doctorProject({ root });
  assert.equal(result.ok, false);
  assert.equal(result.groups.installation.ok, true);
  assert.equal(result.groups.workflow.ok, false);
  assert.equal(result.groups.knowledge.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BODY/);
  const update = await installProject({ root, tools: ['codex'], interactive: false });
  assert.equal(update.ok, true);
  assert.equal(update.doctor.ok, false);
});

test('安装集成失败后保留启用意图，doctor 显式报告不可用且安装不误报失败', async () => {
  const root = await createOpenSpecProject();
  const result = await installProject({
    root, tools: ['codex'], interactive: false, withCodeGraph: true,
    integrations: { installCodeGraph: async () => { throw new Error('PRIVATE_TOOL_FAILURE'); } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.integrations.codegraph, true);
  assert.equal(result.doctor.groups.installation.ok, true);
  assert.equal(result.doctor.groups.integrations.ok, false);
  assert.equal(result.doctor.groups.integrations.codegraph.indexPresent, false);
  assert.equal(result.doctor.groups.integrations.codegraph.freshness, 'not-checked');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOOL_FAILURE/);
});

test('损坏的协作文件返回 workflow 失败分组而不丢失安装诊断', async () => {
  const root = await createOpenSpecProject();
  await installProject({ root, tools: ['codex'], interactive: false });
  await writeFile(path.join(root, '.falla/coordination.yaml'), 'mappings: [PRIVATE_BAD_DATA\n');
  const report = await doctorProject({ root });
  assert.equal(report.groups.installation.ok, true);
  assert.equal(report.groups.workflow.ok, false);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_BAD_DATA/);
});
