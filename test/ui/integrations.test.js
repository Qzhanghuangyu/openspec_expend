import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  installCodeGraph,
  selectCodeGraphInstallation,
} from '../../src/ui/codegraph.js';
import {
  installFigmaMcp,
  selectFigmaMcpInstallation,
} from '../../src/ui/figma-mcp.js';
import {
  installLarkCli,
  loginLarkCli,
  selectLarkCliInstallation,
} from '../../src/ui/lark-cli.js';

test('非交互选择默认禁用外部集成', async () => {
  assert.equal(await selectFigmaMcpInstallation({ interactive: false }), false);
  assert.equal(await selectCodeGraphInstallation({ interactive: false }), false);
  assert.equal(await selectLarkCliInstallation({ interactive: false }), false);
});

test('Figma MCP 对选择的工具使用固定参数数组', async () => {
  const calls = [];
  const results = await installFigmaMcp(['codex', 'claude'], async (command, args) => {
    calls.push({ command, args });
  });

  assert.deepEqual(calls, [
    { command: 'codex', args: ['mcp', 'add', 'figma', '--url', 'https://mcp.figma.com/mcp'] },
    { command: 'claude', args: ['plugin', 'install', 'figma@claude-plugins-official'] },
  ]);
  assert.deepEqual(results, [
    { toolId: 'codex', success: true },
    { toolId: 'claude', success: true },
  ]);
});

test('Lark 安装和登录使用固定参数数组且不接收凭据', async () => {
  const calls = [];
  const runner = async (command, args) => calls.push({ command, args });
  await installLarkCli(runner);
  await loginLarkCli(runner);

  assert.deepEqual(calls, [
    { command: 'npx', args: ['@larksuite/cli@latest', 'install'] },
    { command: 'lark-cli', args: ['auth', 'login'] },
  ]);
});


test('CodeGraph 为所选 Agent 安装 MCP 并首次初始化项目索引', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-codegraph-'));
  const calls = [];
  const result = await installCodeGraph(['codex', 'claude', 'codex'], root,
    async (command, args, options) => calls.push({ command, args, options }));

  assert.deepEqual(calls.map(({ command, args }) => ({ command, args })), [
    {
      command: 'codegraph',
      args: [
        'install', '--target', 'codex,claude', '--location', 'global', '--yes', '--no-permissions',
      ],
    },
    { command: 'codegraph', args: ['init', root] },
  ]);
  assert.equal(calls.every(({ options }) => options.env.OPENAI_API_KEY === undefined), true);
  assert.deepEqual(result, { success: true, action: 'init', tools: ['codex', 'claude'] });
});

test('CodeGraph 已初始化时仅增量同步且拒绝符号链接索引目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-codegraph-'));
  await mkdir(path.join(root, '.codegraph'));
  const calls = [];
  const result = await installCodeGraph(['codex'], root,
    async (command, args) => calls.push({ command, args }));
  assert.deepEqual(calls.at(-1), { command: 'codegraph', args: ['sync', root, '--quiet'] });
  assert.equal(result.action, 'sync');

  const unsafeRoot = await mkdtemp(path.join(os.tmpdir(), 'falla-codegraph-'));
  await symlink(root, path.join(unsafeRoot, '.codegraph'));
  let invoked = false;
  await assert.rejects(
    () => installCodeGraph(['codex'], unsafeRoot, async () => { invoked = true; }),
    (error) => error.code === 1 && error.message.includes('符号链接')
  );
  assert.equal(invoked, false);
});
