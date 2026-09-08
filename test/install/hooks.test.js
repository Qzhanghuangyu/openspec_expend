import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rename, symlink, writeFile } from 'node:fs/promises';
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
