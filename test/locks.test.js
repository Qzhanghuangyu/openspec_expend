import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { withProjectLock } from '../src/locks.js';

test('同一项目的并发安装立即拒绝且锁只记录限定字段', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-lock-'));
  await mkdir(path.join(root, '.falla'));
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const first = withProjectLock(root, 'install', async () => {
    started();
    await new Promise((resolve) => { release = resolve; });
  });
  await startedPromise;

  const lock = JSON.parse(await readFile(path.join(root, '.falla', 'install.lock'), 'utf8'));
  assert.deepEqual(Object.keys(lock).sort(), ['kind', 'pid', 'startedAt']);
  await assert.rejects(
    () => withProjectLock(root, 'install', async () => {}),
    (error) => error.code === 1 && error.message.includes('正在进行')
  );
  release();
  await first;
});

test('异常退出释放安装锁，死亡 PID 的残留锁可恢复一次', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-lock-stale-'));
  await mkdir(path.join(root, '.falla'));
  await writeFile(path.join(root, '.falla', 'install.lock'), JSON.stringify({
    pid: 99999999,
    startedAt: '2026-09-08T00:00:00.000Z',
    kind: 'install',
  }));
  let ran = false;
  await withProjectLock(root, 'install', async () => { ran = true; });
  assert.equal(ran, true);

  await assert.rejects(
    () => withProjectLock(root, 'install', async () => { throw new Error('failure'); }),
    /failure/
  );
  await withProjectLock(root, 'install', async () => {});
});
