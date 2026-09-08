import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProcess } from '../../src/ui/process.js';

test('外部进程使用参数数组且非零退出只返回脱敏摘要', async () => {
  await assert.rejects(
    () => runProcess(process.execPath, ['-e', 'process.stderr.write("SECRET_VALUE"); process.exit(7)'], {
      stdio: 'ignore',
    }),
    (error) => error.message.includes('code=7') && !error.message.includes('SECRET_VALUE')
  );
});

test('外部进程超时后终止并释放等待', async () => {
  await assert.rejects(
    () => runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], {
      stdio: 'ignore',
      timeoutMs: 10,
    }),
    (error) => error.message.includes('超时')
  );
});

test('外部进程忽略 SIGTERM 时升级终止且不遗留子进程', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-process-timeout-'));
  const pidFile = path.join(root, 'pid');
  let childPid;
  try {
    await assert.rejects(
      () => runProcess(process.execPath, ['-e', `
        require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
        process.on('SIGTERM', () => {});
        setTimeout(() => {}, 5000);
      `], {
        stdio: 'ignore',
        timeoutMs: 100,
        killGraceMs: 20,
      }),
      (error) => error.message.includes('超时')
    );
    childPid = Number(await readFile(pidFile, 'utf8'));
    assert.throws(() => process.kill(childPid, 0), (error) => error.code === 'ESRCH');
  } finally {
    if (Number.isInteger(childPid)) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
  }
});
