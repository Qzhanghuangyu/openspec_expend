import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('进程组超时后终止仍在运行的子进程，不在返回后继续产生副作用', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-process-tree-'));
  const parent = path.join(root, 'parent.sh');
  const descendant = path.join(root, 'descendant.sh');
  const pidFile = path.join(root, 'pid');
  const marker = path.join(root, 'late-write');
  let descendantPid;
  try {
    await writeFile(descendant, '#!/bin/sh\n/bin/sleep 2\necho late > "$MARKER"\n');
    await writeFile(parent, '#!/bin/sh\n"$DESCENDANT" &\necho $! > "$PID_FILE"\nwait\n');
    await chmod(descendant, 0o755);
    await chmod(parent, 0o755);
    await assert.rejects(
      () => runProcess(parent, [], {
        env: { DESCENDANT: descendant, PID_FILE: pidFile, MARKER: marker },
        stdio: 'ignore', timeoutMs: 1000, killGraceMs: 100, killTreeOnTimeout: true,
      }),
      (error) => error.message.includes('超时')
    );
    descendantPid = Number(await readFile(pidFile, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await assert.rejects(() => access(marker), (error) => error.code === 'ENOENT');
  } finally {
    if (Number.isInteger(descendantPid)) {
      try { process.kill(descendantPid, 'SIGKILL'); } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('进程组负责人忽略 SIGTERM 时升级 SIGKILL 后仍须结束等待', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-process-group-'));
  const pidFile = path.join(root, 'pid');
  let pid;
  let timeout;
  try {
    await assert.rejects(
      () => Promise.race([
        runProcess(process.execPath, ['-e', `
          require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
          process.on('SIGTERM', () => {});
          setInterval(() => {}, 1000);
        `], { stdio: 'ignore', timeoutMs: 1000, killGraceMs: 100, killTreeOnTimeout: true }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('等待未结束')), 2000); }),
      ]),
      (error) => error.message.includes('超时')
    );
    pid = Number(await readFile(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
  } finally {
    clearTimeout(timeout);
    if (Number.isInteger(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});
