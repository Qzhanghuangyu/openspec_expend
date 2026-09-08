import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installFigmaMcp,
  selectFigmaMcpInstallation,
} from '../../src/ui/figma-mcp.js';
import {
  installLarkCli,
  loginLarkCli,
  selectLarkCliInstallation,
} from '../../src/ui/lark-cli.js';

test('非交互选择默认禁用 Figma 和 Lark', async () => {
  assert.equal(await selectFigmaMcpInstallation({ interactive: false }), false);
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
