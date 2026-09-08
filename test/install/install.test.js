import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { installProject } from '../../src/commands/install.js';

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
    'fallaVersion', 'files', 'formatVersion', 'installedAt', 'openSpecVersion',
  ]);
  assert.equal(manifest.fallaVersion, '0.1.0');
  assert.equal(manifest.openSpecVersion, '1.5.0');
  assert.equal(manifest.installedAt, FIXED_TIME);
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
