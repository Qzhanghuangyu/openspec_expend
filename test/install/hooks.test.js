import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const templates = path.resolve('templates/hooks');

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-hook-'));
  const docs = path.join(root, '.falla', 'skill-spec');
  const nested = path.join(root, 'feature', 'nested');
  await mkdir(docs, { recursive: true });
  await mkdir(path.join(root, 'openspec'), { recursive: true });
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(docs, '[Must Read]soul.md'), 'SOUL_RULE\n', 'utf8');
  await writeFile(path.join(docs, '[分析必读]preflight.md'), 'PREFLIGHT_RULE\n', 'utf8');
  return { root, docs, nested };
}

async function runHook(script, cwd, payload, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd,
      env: { PATH: process.env.PATH, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => resolve({ code: 1, stdout, stderr }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

test('Claude Hook 从项目子目录加载阶段规则并在同会话去重', async () => {
  const { root, nested } = await fixture();
  const script = path.join(templates, 'falla-spec-guard.mjs');
  const payload = {
    session_id: 'session-one',
    cwd: nested,
    tool_input: { name: 'falla-preflight' },
  };

  const first = await runHook(script, nested, payload);
  assert.equal(first.code, 0, first.stderr);
  const output = JSON.parse(first.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /SOUL_RULE/);
  assert.match(output.hookSpecificOutput.additionalContext, /PREFLIGHT_RULE/);

  const second = await runHook(script, nested, payload);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.stdout, '');
  assert.doesNotMatch(first.stdout + first.stderr, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Claude Hook 缺少强制规则时显式阻断', async () => {
  const { docs, nested } = await fixture();
  await rename(
    path.join(docs, '[分析必读]preflight.md'),
    path.join(docs, '[分析必读]preflight.missing')
  );
  const result = await runHook(
    path.join(templates, 'falla-spec-guard.mjs'),
    nested,
    { session_id: 'missing-doc', cwd: nested, tool_input: { name: 'falla-preflight' } }
  );

  assert.equal(result.code, 2);
  assert.match(result.stderr, /缺少强制规则文件/);
  assert.doesNotMatch(result.stderr, /SOUL_RULE/);
});

test('Claude 同会话规则修改后重新注入，删除后不能沿用旧缓存', async () => {
  const { docs, nested } = await fixture();
  const script = path.join(templates, 'falla-spec-guard.mjs');
  const payload = { session_id: 'rules-changed', cwd: nested, tool_input: { name: 'falla-preflight' } };
  assert.equal((await runHook(script, nested, payload)).code, 0);
  await writeFile(path.join(docs, '[Must Read]soul.md'), 'UPDATED_SOUL');
  assert.match((await runHook(script, nested, payload)).stdout, /UPDATED_SOUL/);
  await rename(path.join(docs, '[Must Read]soul.md'), path.join(docs, 'soul.missing'));
  assert.equal((await runHook(script, nested, payload)).code, 2);
});

test('Codex SessionStart 从子目录注入 soul 且缺失时失败', async () => {
  const { docs, nested } = await fixture();
  const script = path.join(templates, 'falla-spec-session.mjs');
  const first = await runHook(script, nested, { cwd: nested });
  assert.equal(first.code, 0, first.stderr);
  assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /SOUL_RULE/);

  await rename(path.join(docs, '[Must Read]soul.md'), path.join(docs, 'soul.missing'));
  const missing = await runHook(script, nested, { cwd: nested });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /缺少强制规则文件/);
});

test('Hook 拒绝通过规则文件符号链接读取项目外内容', async () => {
  const { docs, nested } = await fixture();
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'falla-hook-outside-')), 'secret.md');
  await writeFile(outside, 'OUTSIDE_SECRET\n', 'utf8');
  const soul = path.join(docs, '[Must Read]soul.md');
  await rename(soul, path.join(docs, 'soul.backup'));
  await symlink(outside, soul);

  const claude = await runHook(
    path.join(templates, 'falla-spec-guard.mjs'),
    nested,
    { session_id: 'symlink-rule', cwd: nested, tool_input: { name: 'falla-preflight' } }
  );
  const codex = await runHook(path.join(templates, 'falla-spec-session.mjs'), nested, { cwd: nested });

  assert.equal(claude.code, 2);
  assert.equal(codex.code, 2);
  assert.doesNotMatch(claude.stdout + claude.stderr + codex.stdout + codex.stderr, /OUTSIDE_SECRET/);
});


test('任务 Hook 在启用后增量同步 CodeGraph 且不透传敏感环境变量', async () => {
  const { root, nested } = await fixture();
  await mkdir(path.join(root, '.codegraph'));
  await writeFile(path.join(root, '.falla', 'install-manifest.json'), `${JSON.stringify({
    formatVersion: 3,
    integrations: { codegraph: true },
  })}\n`);
  const bin = await mkdtemp(path.join(os.tmpdir(), 'falla-codegraph-bin-'));
  const log = path.join(bin, 'calls.log');
  const executable = path.join(bin, 'codegraph');
  await writeFile(executable, `#!/bin/sh\nprintf '%s|%s\\n' "$*" "\${OPENAI_API_KEY-unset}" > ${JSON.stringify(log)}\n`);
  await chmod(executable, 0o755);

  const result = await runHook(
    path.join(templates, 'falla-spec-session.mjs'),
    nested,
    { cwd: nested },
    { PATH: `${bin}:${process.env.PATH}`, OPENAI_API_KEY: 'HOOK_SECRET' }
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /CodeGraph.*索引已准备完成/);
  assert.equal(await readFile(log, 'utf8'), `sync ${await realpath(root)} --quiet|unset\n`);
  assert.doesNotMatch(result.stdout + result.stderr, /HOOK_SECRET/);
});

test('CodeGraph 同步失败时 Hook 脱敏降级而不阻断任务', async () => {
  const { root, nested } = await fixture();
  await mkdir(path.join(root, '.codegraph'));
  await writeFile(path.join(root, '.falla', 'install-manifest.json'), `${JSON.stringify({
    formatVersion: 3,
    integrations: { codegraph: true },
  })}\n`);
  const bin = await mkdtemp(path.join(os.tmpdir(), 'falla-codegraph-bin-'));
  const executable = path.join(bin, 'codegraph');
  await writeFile(executable, '#!/bin/sh\necho CODEGRAPH_SECRET >&2\nexit 9\n');
  await chmod(executable, 0o755);

  const result = await runHook(
    path.join(templates, 'falla-spec-session.mjs'),
    nested,
    { cwd: nested },
    { PATH: `${bin}:${process.env.PATH}` }
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /允许降级为有界 rg\/find/);
  assert.doesNotMatch(result.stdout + result.stderr, /CODEGRAPH_SECRET/);
});

test('Claude 每次进入 Falla Skill 均准备 CodeGraph，规则内容仍按会话去重', async () => {
  const { root, nested } = await fixture();
  await writeFile(path.join(root, '.falla', 'install-manifest.json'), `${JSON.stringify({
    formatVersion: 3,
    integrations: { codegraph: true },
  })}\n`);
  const bin = await mkdtemp(path.join(os.tmpdir(), 'falla-codegraph-bin-'));
  const log = path.join(bin, 'calls.log');
  const executable = path.join(bin, 'codegraph');
  await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n`);
  await chmod(executable, 0o755);
  const payload = {
    session_id: 'codegraph-once',
    cwd: nested,
    tool_input: { name: 'falla-preflight' },
  };
  const env = { PATH: `${bin}:${process.env.PATH}` };

  const first = await runHook(path.join(templates, 'falla-spec-guard.mjs'), nested, payload, env);
  const second = await runHook(path.join(templates, 'falla-spec-guard.mjs'), nested, payload, env);

  assert.equal(first.code, 0, first.stderr);
  assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /CodeGraph.*索引已准备完成/);
  assert.equal(second.code, 0, second.stderr);
  assert.match(JSON.parse(second.stdout).hookSpecificOutput.additionalContext, /CodeGraph.*索引已准备完成/);
  assert.doesNotMatch(second.stdout, /SOUL_RULE|PREFLIGHT_RULE/);
  assert.equal(await readFile(log, 'utf8'), `init ${await realpath(root)}\ninit ${await realpath(root)}\n`);
});

test('Claude 同会话的索引失败可在下次 Skill 重试', async () => {
  const { root, nested } = await fixture();
  await writeFile(path.join(root, '.falla/install-manifest.json'), JSON.stringify({ formatVersion: 3, integrations: { codegraph: true } }));
  const bin = await mkdtemp(path.join(os.tmpdir(), 'falla-codegraph-retry-'));
  const executable = path.join(bin, 'codegraph');
  await writeFile(executable, '#!/bin/sh\nexit 9\n');
  await chmod(executable, 0o755);
  const payload = { session_id: 'retry', cwd: nested, tool_input: { name: 'falla-preflight' } };
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const first = await runHook(path.join(templates, 'falla-spec-guard.mjs'), nested, payload, env);
  assert.match(first.stdout, /索引准备失败/);
  await writeFile(executable, '#!/bin/sh\nexit 0\n');
  const second = await runHook(path.join(templates, 'falla-spec-guard.mjs'), nested, payload, env);
  assert.match(second.stdout, /索引已准备完成/);
});
