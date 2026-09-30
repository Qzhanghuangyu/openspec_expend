import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('bin/falla-openspec.js');
const packageVersion = JSON.parse(await (await import('node:fs/promises')).readFile('package.json', 'utf8')).version;

async function runCli(args, env = { PATH: process.env.PATH }) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env,
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
  assert.match(result.stdout, /coordination/);
  assert.match(result.stdout, /coordination unregister/);
  assert.doesNotMatch(result.stdout, /migrate/);
  assert.doesNotMatch(result.stdout, /new change/);
  assert.doesNotMatch(result.stdout, /instructions/);
  assert.doesNotMatch(result.stdout, /archive/);
});

test('--version 输出当前包版本且不依赖项目', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), packageVersion);
  assert.equal(result.stderr, '');
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

test('CLI --with-webp 在已有 cwebp 时启用集成且不运行 Homebrew', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-cli-webp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'cwebp'), '#!/bin/sh\nexit 0\n');
  await writeFile(path.join(bin, 'brew'), '#!/bin/sh\nprintf called > "$HOME/brew-invoked"\nexit 1\n');
  await chmod(path.join(bin, 'cwebp'), 0o755);
  await chmod(path.join(bin, 'brew'), 0o755);
  const result = await runCli([
    'install', root, '--tools', 'codex', '--with-webp', '--non-interactive', '--json',
  ], { PATH: `${bin}:${process.env.PATH}`, HOME: root });
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.integrations, { codegraph: false, webp: true });
  assert.equal(report.doctor.groups.integrations.webp.state, 'available');
  assert.deepEqual(report.warnings, []);
  await assert.rejects(() => readFile(path.join(root, 'brew-invoked')), (error) => error.code === 'ENOENT');
});

test('CLI 首次安装 WebP 时 Homebrew 输出不污染 --json 响应', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-cli-webp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'cwebp'), '#!/bin/sh\ntest -f "$HOME/webp-installed"\n');
  await writeFile(path.join(bin, 'brew'), `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'BREW_VERSION\\n'; exit 0; fi
if [ "$1" = "install" ] && [ "$2" = "webp" ]; then
  printf 'BREW_PROGRESS\\n'
  : > "$HOME/webp-installed"
  exit 0
fi
exit 1
`);
  await chmod(path.join(bin, 'cwebp'), 0o755);
  await chmod(path.join(bin, 'brew'), 0o755);
  const result = await runCli([
    'install', root, '--tools', 'codex', '--with-webp', '--non-interactive', '--json',
  ], { PATH: `${bin}:${process.env.PATH}`, HOME: root });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /BREW_PROGRESS|BREW_VERSION/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.doctor.groups.integrations.webp.state, 'available');
  assert.deepEqual(report.warnings, []);
});
