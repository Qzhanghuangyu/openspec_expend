import { lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from './errors.js';

const ALLOWED_KINDS = new Set(['install', 'coordination', 'knowledge-index']);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

async function readLock(file) {
  const entry = await lstat(file);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size > 4096) {
    throw new FallaError(1, '锁文件格式无效，需要人工检查');
  }
  const raw = await readFile(file, 'utf8');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FallaError(1, '锁文件格式无效，需要人工检查');
  }
  if (!Number.isInteger(value?.pid) || typeof value.startedAt !== 'string' || !ALLOWED_KINDS.has(value.kind)) {
    throw new FallaError(1, '锁文件格式无效，需要人工检查');
  }
  return { raw, value };
}

async function tryAcquire(file, content) {
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

async function releaseOwnedLock(file, content) {
  try {
    if (await readFile(file, 'utf8') === content) await unlink(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function acquireLock(file, kind, content) {
  const recovery = `${file}.recovery`;
  if (await tryAcquire(file, content)) {
    // 恢复者可能在删主锁后崩溃；新创建主锁不能绕过尚在的恢复保护。
    try {
      await lstat(recovery);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      await releaseOwnedLock(file, content);
      throw error;
    }
    await releaseOwnedLock(file, content);
    throw new FallaError(1, `${kind} 恢复保护存在；需先人工核对残留恢复状态`);
  }
  const first = await readLock(file);
  if (isAlive(first.value.pid)) throw new FallaError(1, `${first.value.kind} 操作正在进行`);
  // 自动回收必须独占：否则第二个调用会删除第一个调用刚取得的活锁，CAS 无法补救。
  if (!await tryAcquire(recovery, content)) {
    throw new FallaError(1, `${kind} 残留锁恢复正在进行；恢复保护残留时需人工核对`);
  }
  try {
    let latest;
    try { latest = await readLock(file); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (latest) {
      if (latest.raw !== first.raw || isAlive(latest.value.pid)) {
        throw new FallaError(1, `${kind} 锁已发生变化，拒绝清理`);
      }
      await unlink(file);
    }
    if (!await tryAcquire(file, content)) throw new FallaError(1, `${kind} 操作正在进行`);
  } finally {
    // 只释放自己的保护；恢复进程崩溃后保护残留不进行递归自动回收。
    await releaseOwnedLock(recovery, content);
  }
}

export async function withProjectLock(rootInput, kind, operation) {
  if (!ALLOWED_KINDS.has(kind)) throw new FallaError(1, `不支持的锁类型：${kind}`);
  const root = await realpath(path.resolve(rootInput));
  const falla = path.join(root, '.falla');
  await mkdir(falla, { recursive: true });
  const fallaEntry = await lstat(falla);
  if (fallaEntry.isSymbolicLink() || !fallaEntry.isDirectory()) {
    throw new FallaError(1, '.falla 必须是真实目录，不能是符号链接');
  }
  const file = path.join(falla, `${kind}.lock`);
  const content = `${JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    kind,
  })}\n`;

  const files = [file];
  const acquired = [];
  try {
    for (const lockFile of files) {
      await acquireLock(lockFile, kind, content);
      acquired.push(lockFile);
    }
  } catch (error) {
    for (const lockFile of [...acquired].reverse()) {
      await releaseOwnedLock(lockFile, content);
    }
    throw error;
  }

  try {
    return await operation();
  } finally {
    for (const lockFile of [...acquired].reverse()) {
      await releaseOwnedLock(lockFile, content);
    }
  }
}
