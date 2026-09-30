import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectWebp, installWebp, selectWebpInstallation } from '../../src/ui/webp.js';

async function tools(t, { installed = false, homebrew = true, finishInstall = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-webp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwebp = path.join(root, 'cwebp');
  await writeFile(cwebp, '#!/bin/sh\nprintf "cwebp|%s|%s\\n" "$*" "${FIGMA_ACCESS_TOKEN-unset}" >> "$HOME/calls.log"\ntest -f "$HOME/installed"\n');
  await chmod(cwebp, 0o755);
  if (homebrew) {
    const brew = path.join(root, 'brew');
    await writeFile(brew, `#!/bin/sh
printf "brew|%s|%s\\n" "$*" "\${FIGMA_ACCESS_TOKEN-unset}" >> "$HOME/calls.log"
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "install" ] && [ "$2" = "webp" ]; then
  ${finishInstall ? ': > "$HOME/installed"' : ':'}
  exit 0
fi
exit 1
`);
    await chmod(brew, 0o755);
  }
  if (installed) await writeFile(path.join(root, 'installed'), '');
  return {
    root,
    env: { HOME: root, PATH: root, FIGMA_ACCESS_TOKEN: 'PRIVATE_FIGMA_TOKEN' },
    calls: async () => readFile(path.join(root, 'calls.log'), 'utf8'),
  };
}

test('WebP 未启用时不探测，启用但 CLI 缺失时只返回脱敏状态', async (t) => {
  const { env, calls } = await tools(t);
  assert.deepEqual(await inspectWebp({ enabled: false, env }), {
    enabled: false, available: false, ok: true, state: 'disabled',
  });
  await assert.rejects(calls, (error) => error.code === 'ENOENT');
  const missing = await inspectWebp({ enabled: true, env });
  assert.equal(missing.ok, false);
  assert.equal(missing.state, 'cli-unavailable');
  assert.equal(await calls(), 'cwebp|-version|unset\n');
  assert.doesNotMatch(JSON.stringify(missing), /PRIVATE_FIGMA_TOKEN/);
});

test('WebP 已存在时跳过 Homebrew，交互安装也不重复询问', async (t) => {
  const { env, calls } = await tools(t, { installed: true });
  let prompted = false;
  assert.equal(await selectWebpInstallation({ interactive: true, env, confirm: async () => {
    prompted = true;
    return true;
  } }), false);
  const result = await installWebp(undefined, { env, stdio: 'ignore' });
  assert.deepEqual(result, { success: true, action: 'already-available' });
  assert.equal(prompted, false);
  assert.equal(await calls(), 'cwebp|-version|unset\ncwebp|-version|unset\n');
});

test('WebP 缺失且 Homebrew 可用时安装、复查，并隔离敏感环境变量', async (t) => {
  const { env, calls } = await tools(t);
  const result = await installWebp(undefined, { env, stdio: 'ignore' });
  assert.deepEqual(result, { success: true, action: 'installed' });
  assert.equal(await calls(), [
    'cwebp|-version|unset',
    'brew|--version|unset',
    'brew|install webp|unset',
    'cwebp|-version|unset',
    '',
  ].join('\n'));
});

test('WebP 无 Homebrew 或安装后仍不可用时报告失败，不假装已安装', async (t) => {
  const absent = await tools(t, { homebrew: false });
  await assert.rejects(() => installWebp(undefined, { env: absent.env, stdio: 'ignore' }));
  assert.equal(await absent.calls(), 'cwebp|-version|unset\n');

  const ineffective = await tools(t, { finishInstall: false });
  await assert.rejects(() => installWebp(undefined, { env: ineffective.env, stdio: 'ignore' }));
  assert.match(await ineffective.calls(), /brew\|install webp\|unset\ncwebp\|-version\|unset/);
});

test('WebP 交互式询问仅在缺失时出现，非交互默认不安装', async (t) => {
  const { env } = await tools(t);
  assert.equal(await selectWebpInstallation({ interactive: false, env }), false);
  let question = '';
  assert.equal(await selectWebpInstallation({ interactive: true, env, confirm: async (value) => {
    question = value;
    return true;
  } }), true);
  assert.match(question, /Homebrew/);
});

test('Homebrew 安装路径启用进程组超时清理，探测路径不改动', async () => {
  const calls = [];
  let installed = false;
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'cwebp' && !installed) throw new Error('missing');
    if (command === 'brew' && args[0] === 'install') installed = true;
  };
  await installWebp(runner, { env: { PATH: '/usr/bin' } });
  const installation = calls.find(({ command, args }) => command === 'brew' && args[0] === 'install');
  assert.equal(installation.options.killTreeOnTimeout, true);
  assert.equal(calls[0].options.killTreeOnTimeout, undefined);
});
