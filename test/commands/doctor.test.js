import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { doctorProject } from '../../src/commands/doctor.js';
import { installProject } from '../../src/commands/install.js';

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

test('doctor 报告不包含环境变量或规格正文', async () => {
  const root = await createOpenSpecProject();
  const reportText = JSON.stringify(await doctorProject({ root }));

  assert.doesNotMatch(reportText, /processEnv|documentBody|OPENAI_API_KEY/);
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
