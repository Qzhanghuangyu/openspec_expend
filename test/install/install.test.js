import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { installProject } from '../../src/commands/install.js';
import {
  applyManagedFileRemovalPlan,
  planManagedFileRemovals,
} from '../../src/install/files.js';
import {
  applyHookRemovalPlan,
  planHookRemovals,
} from '../../src/install/hooks.js';

const execFileAsync = promisify(execFile);
const FIXED_TIME = '2026-09-08T08:00:00.000Z';

async function createProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-install-'));
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  return root;
}

function installOptions(root, overrides = {}) {
  return {
    root,
    tools: ['claude', 'codex'],
    interactive: false,
    executable: 'openspec',
    now: () => FIXED_TIME,
    integrations: {
      installFigma: async () => { throw new Error('不应调用 Figma'); },
      installLark: async () => { throw new Error('不应调用 Lark'); },
    },
    ...overrides,
  };
}

test('初装写入四套 Schema、规则、双工具 Skill、Hook 和安全 manifest', async () => {
  const root = await createProject();
  const report = await installProject(installOptions(root));

  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 0);
  for (const schema of [
    'falla-spec-driven',
    'falla-task-driven',
    'falla-legacy-spec-driven',
    'falla-legacy-task-driven',
  ]) {
    assert.match(
      await readFile(path.join(root, 'openspec', 'schemas', schema, 'schema.yaml'), 'utf8'),
      /name:/
    );
  }
  assert.match(
    await readFile(path.join(root, '.falla', 'skill-spec', '[Must Read]soul.md'), 'utf8'),
    /FallaOpenSpec 的灵魂/
  );
  assert.match(
    await readFile(path.join(root, '.falla', 'skill-spec', '[分析必读]preflight.md'), 'utf8'),
    /Stateful Interactions/
  );
  for (const tool of ['.claude', '.codex']) {
    assert.match(
      await readFile(path.join(root, tool, 'skills', 'falla-preflight', 'SKILL.md'), 'utf8'),
      /name: falla-preflight/
    );
  }
  assert.match(
    await readFile(path.join(root, '.claude', 'hooks', 'falla-spec-guard.mjs'), 'utf8'),
    /\.falla.*skill-spec/s
  );
  assert.match(
    await readFile(path.join(root, '.codex', 'hooks', 'falla-spec-session.mjs'), 'utf8'),
    /\.falla.*skill-spec/s
  );

  const manifestText = await readFile(path.join(root, '.falla', 'install-manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(Object.keys(manifest).sort(), [
    'fallaVersion', 'files', 'formatVersion', 'installedAt', 'openSpecVersion', 'tools',
  ]);
  assert.equal(manifest.formatVersion, 2);
  assert.equal(manifest.fallaVersion, '0.2.0');
  assert.equal(manifest.openSpecVersion, '1.12.0');
  assert.equal(manifest.installedAt, FIXED_TIME);
  assert.deepEqual(manifest.tools, ['claude', 'codex']);
  assert.ok(Object.keys(manifest.files).every((entry) => !path.isAbsolute(entry)));
  assert.ok(Object.values(manifest.files).every((digest) => /^[a-f0-9]{64}$/.test(digest)));
  assert.doesNotMatch(manifestText, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('重复安装保持 manifest 和 marker 幂等', async () => {
  const root = await createProject();
  await installProject(installOptions(root));
  const manifestPath = path.join(root, '.falla', 'install-manifest.json');
  const before = await readFile(manifestPath, 'utf8');

  const report = await installProject(installOptions(root));
  const after = await readFile(manifestPath, 'utf8');
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  const codexConfig = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');

  assert.equal(report.ok, true);
  assert.equal(before, after);
  assert.equal(agents.match(/<!-- falla-spec-guard:start -->/g)?.length, 1);
  assert.equal(codexConfig.match(/# falla-spec-session:start/g)?.length, 1);
});

test('受管文件被用户修改后停止且不覆盖', async () => {
  const root = await createProject();
  await installProject(installOptions(root));
  const skill = path.join(root, '.codex', 'skills', 'falla-preflight', 'SKILL.md');
  await writeFile(skill, 'user edit\n', 'utf8');

  await assert.rejects(
    () => installProject(installOptions(root)),
    (error) => error.code === 1 && error.message.includes('用户修改') && error.message.includes('.codex/skills')
  );
  assert.equal(await readFile(skill, 'utf8'), 'user edit\n');
});

test('重新选择工具时安全移除未选择工具的受管文件和 Hook', async () => {
  const root = await createProject();
  await installProject(installOptions(root));

  const report = await installProject(installOptions(root, { tools: ['codex'] }));

  assert.equal(report.ok, true);
  assert.ok(report.removed.includes('.claude/hooks/falla-spec-guard.mjs'));
  assert.ok(report.removed.includes('.claude/skills/falla-preflight/SKILL.md'));
  await assert.rejects(
    () => readFile(path.join(root, '.claude', 'hooks', 'falla-spec-guard.mjs')),
    (error) => error.code === 'ENOENT'
  );
  await assert.rejects(
    () => readFile(path.join(root, '.claude', 'skills', 'falla-preflight', 'SKILL.md')),
    (error) => error.code === 'ENOENT'
  );
  const claudeSettings = await readFile(path.join(root, '.claude', 'settings.json'), 'utf8');
  assert.doesNotMatch(claudeSettings, /falla-spec-guard\.mjs/);
  await readFile(path.join(root, '.codex', 'skills', 'falla-preflight', 'SKILL.md'));

  const manifest = JSON.parse(await readFile(
    path.join(root, '.falla', 'install-manifest.json'),
    'utf8'
  ));
  assert.deepEqual(manifest.tools, ['codex']);
  assert.equal(Object.keys(manifest.files).some((entry) => entry.startsWith('.claude/')), false);
});

test('待清理的受管文件或 Hook 被用户修改时拒绝删除', async () => {
  const fileRoot = await createProject();
  await installProject(installOptions(fileRoot));
  const skill = path.join(fileRoot, '.claude', 'skills', 'falla-preflight', 'SKILL.md');
  await writeFile(skill, 'user-owned skill\n', 'utf8');
  await assert.rejects(
    () => installProject(installOptions(fileRoot, { tools: ['codex'] })),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.equal(await readFile(skill, 'utf8'), 'user-owned skill\n');

  const hookRoot = await createProject();
  await installProject(installOptions(hookRoot));
  const settingsPath = path.join(hookRoot, '.claude', 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  const fallaHook = settings.hooks.PreToolUse.find((entry) =>
    entry.hooks?.some((hook) => hook.command?.includes('falla-spec-guard.mjs')));
  fallaHook.hooks[0].command += ' --user-edit';
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  await assert.rejects(
    () => installProject(installOptions(hookRoot, { tools: ['codex'] })),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.match(await readFile(settingsPath, 'utf8'), /--user-edit/);
});

test('旧版 v1 manifest 可升级并安全清理未选择工具', async () => {
  const root = await createProject();
  await installProject(installOptions(root));
  const manifestPath = path.join(root, '.falla', 'install-manifest.json');
  const current = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete current.tools;
  current.formatVersion = 1;
  await writeFile(manifestPath, `${JSON.stringify(current, null, 2)}\n`);

  const report = await installProject(installOptions(root, { tools: ['codex'] }));
  const upgraded = JSON.parse(await readFile(manifestPath, 'utf8'));

  assert.equal(report.ok, true);
  assert.equal(upgraded.formatVersion, 2);
  assert.deepEqual(upgraded.tools, ['codex']);
  assert.equal(Object.keys(upgraded.files).some((entry) => entry.startsWith('.claude/')), false);
});

test('只保留 Claude 时移除 Codex marker 并保留共享文件中的用户内容', async () => {
  const root = await createProject();
  await installProject(installOptions(root));
  const agentsPath = path.join(root, 'AGENTS.md');
  const configPath = path.join(root, '.codex', 'config.toml');
  await writeFile(agentsPath, `${await readFile(agentsPath, 'utf8')}\n用户规则保留\n`);
  await writeFile(configPath, `${await readFile(configPath, 'utf8')}\nuser_setting = true\n`);

  const report = await installProject(installOptions(root, { tools: ['claude'] }));

  assert.ok(report.removed.includes('AGENTS.md'));
  assert.ok(report.removed.includes('.codex/config.toml'));
  assert.doesNotMatch(await readFile(agentsPath, 'utf8'), /falla-spec-guard:start/);
  assert.match(await readFile(agentsPath, 'utf8'), /用户规则保留/);
  assert.doesNotMatch(await readFile(configPath, 'utf8'), /falla-spec-session:start/);
  assert.match(await readFile(configPath, 'utf8'), /user_setting = true/);
  await assert.rejects(
    () => readFile(path.join(root, '.codex', 'hooks', 'falla-spec-session.mjs')),
    (error) => error.code === 'ENOENT'
  );
});

test('Hook 删除计划应用前发生并发修改时拒绝覆盖', async () => {
  const root = await createProject();
  await installProject(installOptions(root));
  const manifest = JSON.parse(await readFile(
    path.join(root, '.falla', 'install-manifest.json'),
    'utf8'
  ));
  const plans = await planHookRemovals(root, ['AGENTS.md'], manifest.files);
  const agentsPath = path.join(root, 'AGENTS.md');
  const changed = (await readFile(agentsPath, 'utf8')).replace(
    'FallaOpenSpec Skill 约束',
    '用户并发修改的 FallaOpenSpec Skill 约束'
  );
  await writeFile(agentsPath, changed);

  await assert.rejects(
    () => applyHookRemovalPlan(root, plans),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.equal(await readFile(agentsPath, 'utf8'), changed);
});

test('受管文件删除计划应用前发生并发修改时拒绝删除', async () => {
  const root = await createProject();
  await installProject(installOptions(root));
  const manifest = JSON.parse(await readFile(
    path.join(root, '.falla', 'install-manifest.json'),
    'utf8'
  ));
  const relativePath = '.claude/skills/falla-preflight/SKILL.md';
  const plans = await planManagedFileRemovals(root, [relativePath], manifest.files);
  const skillPath = path.join(root, ...relativePath.split('/'));
  await writeFile(skillPath, 'user edit after planning\n');

  await assert.rejects(
    () => applyManagedFileRemovalPlan(root, plans),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.equal(await readFile(skillPath, 'utf8'), 'user edit after planning\n');
});

test('非交互默认不调用可选集成，显式失败只产生 warning', async () => {
  const root = await createProject();
  const calls = [];
  const integrations = {
    installFigma: async (tools) => {
      calls.push(['figma', ...tools]);
      throw new Error('FIGMA_SECRET should not leak');
    },
    installLark: async () => {
      calls.push(['lark']);
      throw new Error('LARK_SECRET should not leak');
    },
  };

  await installProject(installOptions(root, { integrations }));
  assert.deepEqual(calls, []);

  const report = await installProject(installOptions(root, {
    integrations,
    withFigma: true,
    withLark: true,
  }));
  assert.deepEqual(calls, [['figma', 'claude', 'codex'], ['lark']]);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings.map(({ integration }) => integration), ['figma', 'lark']);
  assert.doesNotMatch(JSON.stringify(report), /FIGMA_SECRET|LARK_SECRET/);
});

test('交互安装通过欢迎页和选择器决定工具及可选集成', async () => {
  const root = await createProject();
  const calls = [];
  const report = await installProject(installOptions(root, {
    tools: undefined,
    interactive: true,
    ui: {
      showWelcomeScreen: async () => { calls.push('welcome'); },
      selectTools: async () => { calls.push('tools'); return ['codex']; },
      selectFigma: async () => { calls.push('select-figma'); return true; },
      selectLark: async () => { calls.push('select-lark'); return false; },
    },
    integrations: {
      installFigma: async (tools) => { calls.push(['figma', ...tools]); return []; },
      installLark: async () => { calls.push('lark'); },
    },
  }));

  assert.equal(report.ok, true);
  assert.deepEqual(report.tools, ['codex']);
  assert.deepEqual(calls, [
    'welcome', 'tools', 'select-figma', 'select-lark', ['figma', 'codex'],
  ]);
});

test('已有活动安装锁时安装器在写文件前停止', async () => {
  const root = await createProject();
  await mkdir(path.join(root, '.falla'), { recursive: true });
  await writeFile(path.join(root, '.falla', 'install.lock'), `${JSON.stringify({
    pid: process.pid,
    startedAt: FIXED_TIME,
    kind: 'install',
  })}\n`);

  await assert.rejects(
    () => installProject(installOptions(root)),
    (error) => error.code === 1 && error.message.includes('正在进行')
  );
  await assert.rejects(
    () => readFile(path.join(root, '.falla', 'install-manifest.json')),
    (error) => error.code === 'ENOENT'
  );
});
