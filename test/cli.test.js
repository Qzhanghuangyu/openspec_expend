import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('bin/falla-openspec.js');

async function runCli(args) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

test('--help 只暴露 Falla 扩展命令', async () => {
  const result = await runCli(['--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /install/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /migrate/);
  assert.match(result.stdout, /coordination/);
  assert.doesNotMatch(result.stdout, /new change/);
  assert.doesNotMatch(result.stdout, /instructions/);
  assert.doesNotMatch(result.stdout, /archive/);
});

test('未知命令返回稳定错误且不输出调用栈', async () => {
  const result = await runCli(['unknown-command']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /未知命令/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('--debug 只追加技术栈且不输出环境变量', async () => {
  const result = await runCli(['unknown-command', '--debug']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /未知命令/);
  assert.match(result.stderr, /\n\s+at /);
  assert.doesNotMatch(result.stderr, /OPENAI_API_KEY|process\.env/);
});
