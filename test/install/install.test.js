import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
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
      installCodeGraph: async () => { throw new Error('不应调用 CodeGraph'); },
      installLark: async () => { throw new Error('不应调用 Lark'); },
    },
    ...overrides,
  };
}

function runShell(command, { cwd, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('初装写入两套 Schema、规则、双工具 Skill、Hook 和安全 manifest', async () => {
  const root = await createProject();
  const report = await installProject(installOptions(root));

  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 0);
  for (const schema of [
    'falla-spec-driven',
    'falla-task-driven',
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
  const installedManual = await readFile(
    path.join(root, '.falla', 'installation-and-update.md'),
    'utf8'
  );
  assert.match(installedManual, /重复执行 install 完成更新/);
  assert.doesNotMatch(installedManual, /androidCopy|\$HOME\/android\/|\/Users\/|\/home\//);
  assert.match(
    await readFile(path.join(root, '.falla', 'skill-spec', '[分析必读]preflight.md'), 'utf8'),
    /Stateful Interactions/
  );
  assert.match(
    await readFile(path.join(root, '.falla', 'ui-knowledge', 'README.md'), 'utf8'),
    /安装、更新、SessionStart 和普通功能任务不得扫描全仓、自动生成条目/
  );
  await readFile(path.join(root, '.falla', 'ui-knowledge', 'schema-v1.md'));
  await readFile(path.join(root, '.falla', 'ui-knowledge', 'config.example.yaml'));
  await readFile(path.join(root, '.falla', 'ui-knowledge', 'templates', 'component.md'));
  await readFile(path.join(root, '.falla', 'ui-knowledge', 'templates', 'screen-pattern.md'));
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
  await readFile(path.join(root, '.claude', 'hooks', 'falla-codegraph.mjs'));
  await readFile(path.join(root, '.codex', 'hooks', 'falla-codegraph.mjs'));
  assert.equal(
    await readFile(path.join(root, '.gitignore'), 'utf8'),
    '.codegraph/\n.falla/ui-knowledge/.index/\n'
  );
  assert.ok(report.written.includes('.gitignore'));

  const manifestText = await readFile(path.join(root, '.falla', 'install-manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(Object.keys(manifest).sort(), [
    'fallaVersion', 'files', 'formatVersion', 'installedAt', 'integrations', 'openSpecVersion', 'tools',
  ]);
  assert.equal(manifest.formatVersion, 3);
  assert.equal(manifest.fallaVersion, '0.4.0');
  assert.equal(manifest.openSpecVersion, '1.12.0');
  assert.equal(manifest.installedAt, FIXED_TIME);
  assert.deepEqual(manifest.tools, ['claude', 'codex']);
  assert.deepEqual(manifest.integrations, { codegraph: false });
  assert.equal(manifest.files['.gitignore'], undefined);
  assert.ok(Object.keys(manifest.files).every((entry) => !path.isAbsolute(entry)));
  assert.ok(Object.values(manifest.files).every((digest) => /^[a-f0-9]{64}$/.test(digest)));
  assert.doesNotMatch(manifestText, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Codex Hook 注册在项目移动后仍能从子目录启动', async () => {
  const root = await createProject();
  await installProject(installOptions(root, { tools: ['codex'] }));
  const config = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  const commandLine = config.match(/^command = (.+)$/m);
  assert.ok(commandLine);
  const command = JSON.parse(commandLine[1]);
  assert.doesNotMatch(command, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const movedRoot = `${root}-moved`;
  await rename(root, movedRoot);
  const nested = path.join(movedRoot, 'feature', 'nested');
  await mkdir(nested, { recursive: true });
  const result = await runShell(command, {
    cwd: os.tmpdir(),
    input: JSON.stringify({ cwd: nested }),
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /FallaOpenSpec/);

  await unlink(path.join(movedRoot, '.codex', 'hooks', 'falla-spec-session.mjs'));
  const missing = await runShell(command, {
    cwd: os.tmpdir(),
    input: JSON.stringify({ cwd: nested }),
  });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /Hook 启动失败/);
  assert.doesNotMatch(missing.stderr, new RegExp(
    movedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ));
});

test('Codex Hook 启动器拒绝通过符号链接执行项目外脚本', async () => {
  const root = await createProject();
  await installProject(installOptions(root, { tools: ['codex'] }));
  const config = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  const commandLine = config.match(/^command = (.+)$/m);
  assert.ok(commandLine);
  const command = JSON.parse(commandLine[1]);

  const hooks = path.join(root, '.codex', 'hooks');
  await rename(hooks, path.join(root, '.codex', 'managed-hooks'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'falla-outside-hooks-'));
  await writeFile(
    path.join(outside, 'falla-spec-session.mjs'),
    "process.stdout.write('OUTSIDE_SCRIPT_EXECUTED')\n"
  );
  await symlink(outside, hooks, 'dir');

  const result = await runShell(command, {
    cwd: os.tmpdir(),
    input: JSON.stringify({ cwd: root }),
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Hook 启动失败/);
  assert.doesNotMatch(result.stdout, /OUTSIDE_SCRIPT_EXECUTED/);
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

test('初始化保留已有忽略规则并幂等追加项目本地派生索引', async () => {
  const root = await createProject();
  const gitIgnorePath = path.join(root, '.gitignore');
  await writeFile(gitIgnorePath, 'build/\n.env', 'utf8');

  const first = await installProject(installOptions(root));
  await writeFile(gitIgnorePath, `${await readFile(gitIgnorePath, 'utf8')}local-cache/\n`);
  const second = await installProject(installOptions(root));
  const content = await readFile(gitIgnorePath, 'utf8');

  assert.equal(
    content,
    'build/\n.env\n.codegraph/\n.falla/ui-knowledge/.index/\nlocal-cache/\n'
  );
  assert.equal(content.match(/^\.codegraph\/$/gm)?.length, 1);
  assert.equal(content.match(/^\.falla\/ui-knowledge\/\.index\/$/gm)?.length, 1);
  assert.ok(first.written.includes('.gitignore'));
  assert.ok(second.skipped.includes('.gitignore'));
});

test('初始化拒绝通过符号链接改写项目外的忽略文件', async () => {
  const root = await createProject();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'falla-outside-gitignore-'));
  const outsideGitIgnore = path.join(outside, '.gitignore');
  await writeFile(outsideGitIgnore, 'outside-rule/\n', 'utf8');
  await symlink(outsideGitIgnore, path.join(root, '.gitignore'));

  await assert.rejects(
    () => installProject(installOptions(root)),
    (error) => error.code === 1 && error.message.includes('普通文件')
  );
  assert.equal(await readFile(outsideGitIgnore, 'utf8'), 'outside-rule/\n');
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
  delete current.integrations;
  current.formatVersion = 1;
  await writeFile(manifestPath, `${JSON.stringify(current, null, 2)}\n`);

  const report = await installProject(installOptions(root, { tools: ['codex'] }));
  const upgraded = JSON.parse(await readFile(manifestPath, 'utf8'));

  assert.equal(report.ok, true);
  assert.equal(upgraded.formatVersion, 3);
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
    installCodeGraph: async (tools, projectRoot) => {
      calls.push(['codegraph', ...tools, projectRoot === await realpath(root)]);
      throw new Error('CODEGRAPH_SECRET should not leak');
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
    withCodeGraph: true,
    withLark: true,
  }));
  assert.deepEqual(calls, [
    ['figma', 'claude', 'codex'],
    ['codegraph', 'claude', 'codex', true],
    ['lark'],
  ]);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings.map(({ integration }) => integration), ['figma', 'codegraph', 'lark']);
  assert.doesNotMatch(JSON.stringify(report), /FIGMA_SECRET|CODEGRAPH_SECRET|LARK_SECRET/);
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
      selectCodeGraph: async () => { calls.push('select-codegraph'); return true; },
      selectLark: async () => { calls.push('select-lark'); return false; },
    },
    integrations: {
      installFigma: async (tools) => { calls.push(['figma', ...tools]); return []; },
      installCodeGraph: async (tools, projectRoot) => {
        calls.push(['codegraph', ...tools, projectRoot === await realpath(root)]);
      },
      installLark: async () => { calls.push('lark'); },
    },
  }));

  assert.equal(report.ok, true);
  assert.deepEqual(report.tools, ['codex']);
  assert.deepEqual(calls, [
    'welcome', 'tools', 'select-figma', 'select-codegraph', 'select-lark',
    ['figma', 'codex'], ['codegraph', 'codex', true],
  ]);
});


test('CodeGraph 启用状态在普通更新中保留且不重复安装', async () => {
  const root = await createProject();
  const calls = [];
  await installProject(installOptions(root, {
    withCodeGraph: true,
    integrations: {
      installCodeGraph: async () => { calls.push('install'); },
    },
  }));
  await installProject(installOptions(root, {
    integrations: {
      installCodeGraph: async () => { calls.push('unexpected'); },
    },
  }));

  const manifest = JSON.parse(await readFile(
    path.join(root, '.falla', 'install-manifest.json'),
    'utf8'
  ));
  assert.deepEqual(calls, ['install']);
  assert.deepEqual(manifest.integrations, { codegraph: true });
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
