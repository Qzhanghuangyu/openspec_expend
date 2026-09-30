import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

test('残留恢复保护存在时拒绝二次清理，不删除可能已重新取得的活锁', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-lock-recovery-'));
  try {
    await mkdir(path.join(root, '.falla'));
    const file = path.join(root, '.falla', 'coordination.lock');
    const stale = JSON.stringify({ pid: 99999999, startedAt: '2026-09-08T00:00:00.000Z', kind: 'coordination' });
    await writeFile(file, stale);
    await writeFile(`${file}.recovery`, JSON.stringify({ pid: process.pid, startedAt: '2026-09-30T00:00:00.000Z', kind: 'coordination' }));
    let called = false;
    await assert.rejects(() => withProjectLock(root, 'coordination', async () => { called = true; }), /恢复|清理|正在/);
    assert.equal(called, false);
    assert.equal(await readFile(file, 'utf8'), stale);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('同一残留锁的并发恢复只允许一个操作进入且释放恢复保护', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-lock-two-recovery-'));
  try {
    await mkdir(path.join(root, '.falla'));
    await writeFile(path.join(root, '.falla', 'coordination.lock'), JSON.stringify({
      pid: 99999999, startedAt: '2026-09-08T00:00:00.000Z', kind: 'coordination',
    }));
    let entrants = 0;
    let finish;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const operation = async () => { entrants += 1; started(); await new Promise(resolve => { finish = resolve; }); };
    const first = withProjectLock(root, 'coordination', operation).then(() => 'ok', () => 'rejected');
    const second = withProjectLock(root, 'coordination', operation).then(() => 'ok', () => 'rejected');
    await ready;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(entrants, 1);
    finish();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.sort(), ['ok', 'rejected']);
    await assert.rejects(() => readFile(path.join(root, '.falla', 'coordination.lock.recovery')), { code: 'ENOENT' });
    await withProjectLock(root, 'coordination', async () => {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('主锁已被删除但恢复保护残留时停止，不调用 operation 或遗留新主锁', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-lock-orphan-recovery-'));
  try {
    await mkdir(path.join(root, '.falla'));
    const file = path.join(root, '.falla', 'coordination.lock');
    const recovery = JSON.stringify({ pid: 99999999, startedAt: '2026-09-08T00:00:00.000Z', kind: 'coordination' });
    await writeFile(`${file}.recovery`, recovery);
    let called = false;
    await assert.rejects(() => withProjectLock(root, 'coordination', async () => { called = true; }), /恢复|清理/);
    assert.equal(called, false);
    assert.equal(await readFile(`${file}.recovery`, 'utf8'), recovery);
    await assert.rejects(() => readFile(file), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('确定性真实 I/O 调度中，残留锁同时回收和晚获恢复保护均不会双重认领', async () => {
  const execute = promisify(execFile);
  for (const args of [[], ['--late-guard']]) {
    const { stdout } = await execute(process.execPath, [path.resolve('test/helpers/stale-lock-race.mjs'), ...args], {
      cwd: process.cwd(), timeout: 25000, maxBuffer: 128 * 1024,
    });
    const report = JSON.parse(stdout);
    assert.equal(report.timedOut, false);
    assert.equal(report.results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(report.finalOwner, 'alice');
  }
});
