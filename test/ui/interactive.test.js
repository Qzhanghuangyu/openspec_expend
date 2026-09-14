import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { selectCodeGraphInstallation } from '../../src/ui/codegraph.js';
import { selectTools } from '../../src/ui/tool-select.js';
import { showWelcomeScreen } from '../../src/ui/welcome-screen.js';
import { selectFigmaMcpInstallation } from '../../src/ui/figma-mcp.js';
import { selectLarkCliInstallation } from '../../src/ui/lark-cli.js';

function fakeInput() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = false;
  input.resume = () => {};
  input.pause = () => {};
  input.setRawMode = (value) => { input.isRaw = value; };
  return input;
}

function fakeOutput(tty = true) {
  let value = '';
  return {
    isTTY: tty,
    columns: 100,
    write: (chunk) => { value += chunk; },
    value: () => value,
  };
}

test('非交互欢迎界面只渲染一次且不创建定时器', async () => {
  const stdout = fakeOutput(false);
  let intervalCalls = 0;
  await showWelcomeScreen({
    interactive: false,
    stdout,
    setInterval: () => { intervalCalls += 1; },
  });

  assert.match(stdout.value(), /FallaOpenSpec/);
  assert.equal(intervalCalls, 0);
});

test('交互欢迎动画在确认后清理定时器、监听器和 raw mode', async () => {
  const stdin = fakeInput();
  const stdout = fakeOutput();
  const timer = Symbol('timer');
  let cleared = null;
  const promise = showWelcomeScreen({
    interactive: true,
    stdin,
    stdout,
    env: {},
    setInterval: (callback) => {
      callback();
      return timer;
    },
    clearInterval: (value) => { cleared = value; },
  });
  stdin.emit('data', Buffer.from('\n'));
  await promise;

  assert.equal(cleared, timer);
  assert.equal(stdin.isRaw, false);
  assert.equal(stdin.listenerCount('data'), 0);
});

test('工具选择确认后返回选择项并恢复终端状态', async () => {
  const stdin = fakeInput();
  const stdout = fakeOutput();
  const promise = selectTools([
    { id: 'claude', name: 'Claude Code' },
    { id: 'codex', name: 'Codex' },
  ], { interactive: true, stdin, stdout });
  stdin.emit('data', Buffer.from(' '));
  stdin.emit('data', Buffer.from('\n'));
  const selected = await promise;

  assert.deepEqual(selected, ['codex']);
  assert.equal(stdin.isRaw, false);
  assert.equal(stdin.listenerCount('data'), 0);
});

test('交互模式可显式确认 Figma、CodeGraph 和跳过 Lark', async () => {
  const figmaInput = fakeInput();
  const figmaPromise = selectFigmaMcpInstallation({
    interactive: true,
    stdin: figmaInput,
    stdout: fakeOutput(),
  });
  figmaInput.emit('data', Buffer.from('\n'));
  assert.equal(await figmaPromise, true);

  const codeGraphInput = fakeInput();
  const codeGraphPromise = selectCodeGraphInstallation({
    interactive: true,
    stdin: codeGraphInput,
    stdout: fakeOutput(),
  });
  codeGraphInput.emit('data', Buffer.from('\n'));
  assert.equal(await codeGraphPromise, true);

  const larkInput = fakeInput();
  const larkPromise = selectLarkCliInstallation({
    interactive: true,
    stdin: larkInput,
    stdout: fakeOutput(),
  });
  larkInput.emit('data', Buffer.from('\u001b[B'));
  larkInput.emit('data', Buffer.from('\n'));
  assert.equal(await larkPromise, false);
  assert.equal(larkInput.listenerCount('data'), 0);
});
