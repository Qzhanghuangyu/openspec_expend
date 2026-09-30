/**
 * 确定性恢复锁并发调度，仅延迟真实 I/O，不伪造文件内容/hash/官方状态。
 * 此 helper 不在 node:test 进程中改动 builtin 导出；每个调度由独立子进程运行。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const lateGuard = process.argv.includes('--late-guard');
const exec = promisify(execFile);
const original = { readFile: fs.readFile, writeFile: fs.writeFile, rename: fs.rename, unlink: fs.unlink };
const root = await fs.mkdtemp('/private/tmp/w02-lock-regression-');
const executable = path.join(repo, 'node_modules/.bin/openspec');
const official = async (...args) => JSON.parse((await exec(executable, [...args, '--json'], { cwd: root, timeout: 10000 })).stdout);
const context = new AsyncLocalStorage();
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const gates = {
  bothInitial: deferred(), aliceUnlink: deferred(), bobDecision: deferred(),
  aliceMainWritten: deferred(), bothHashes: deferred(), aliceDone: deferred(), aliceGuardReleased: deferred(),
};
const initialReads = new Set();
const mainUnlinks = new Set();
const hashChecks = new Set();
const events = [];
const file = path.join(root, 'openspec/changes/page/comate.md');
const lock = path.join(root, '.falla/coordination.lock');
const recovery = `${lock}.recovery`;
let timer;
let pending = [];
let timedOut = false;



try {
  let claimModule = pathToFileURL(path.join(repo, 'src/coordination/claim.js')).href;
  const { claimChange } = await import(claimModule);
  await exec(executable, ['init', '--tools', 'none', '.'], { cwd: root, timeout: 10000 });
  await fs.cp(path.join(repo, 'templates/openspec/schemas'), path.join(root, 'openspec/schemas'), { recursive: true });
  await official('new', 'change', 'page', '--schema', 'falla-spec-driven');
  for (const [name, content] of Object.entries({
    '.openspec.yaml': 'schema: falla-spec-driven\nskip_specs: true\n',
    'preflight.md': '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\n---\n',
    'proposal.md': '# 合成范围\n', 'design.md': '# 合成设计\n',
    'tasks.md': '<!-- falla-tasks-format: 1 -->\n## 1. 实施\n- [ ] 1.1 合成任务（依赖：无）\n',
    'comate.md': '# comate\n- 格式版本 (format-version): 2\n- 执行模式 (execution-mode): single\n- 负责人 (owner): unassigned\n- 状态 (status): todo\n- 验证模式 (validation-mode): hybrid\n- 人工验证状态 (human-review): not-required\n- 依赖 (depends-on): []\n- 交接 (handoff):\n  - 验证证据：合成数据\n',
  })) await fs.writeFile(path.join(path.dirname(file), name), content);
  await fs.mkdir(path.dirname(lock), { recursive: true });
  const deadPid = 2147483647;
  assert.throws(() => process.kill(deadPid, 0), { code: 'ESRCH' });
  await fs.writeFile(lock, JSON.stringify({ pid: deadPid, startedAt: '2026-09-29T00:00:00.000Z', kind: 'coordination' }) + '\n');

  fs.readFile = async (candidate, ...args) => {
    const result = await original.readFile(candidate, ...args);
    const id = context.getStore();
    if (candidate === lock && id && !initialReads.has(id)) {
      // 双方初次读取都是真实旧主锁。Alice 先推进，Bob 留到 Alice 的删除边界。
      initialReads.add(id); events.push(`${id}:read-stale-main`);
      if (initialReads.size === 2) gates.bothInitial.resolve();
      await gates.bothInitial.promise;
      if (id === 'bob') await gates.aliceUnlink.promise;
    }
    if (candidate === file && id && !hashChecks.has(id)) {
      // record-files 用 open/handle.read；这里是 writeAtomicFile 的真实 CAS hash 读取。
      hashChecks.add(id); events.push(`${id}:read-old-CAS-input`);
      if (hashChecks.size === 2) gates.bothHashes.resolve();
      await gates.bothHashes.promise;
    }
    return result;
  };
  fs.unlink = async candidate => {
    const id = context.getStore();
    if (candidate === lock && id && !mainUnlinks.has(id)) {
      mainUnlinks.add(id); events.push(`${id}:at-main-unlink`);
      if (id === 'alice') {
        gates.aliceUnlink.resolve();
        // 默认 guard 争用：等 Bob 被拒绝。旧锁：等 Bob 也到 unlink。
        // late-guard：Alice 先完成恢复并释放 guard，让 Bob 获得 guard 后重新检查主锁。
        if (!lateGuard) await gates.bobDecision.promise;
      } else {
        gates.bobDecision.resolve();
        await gates.aliceMainWritten.promise;
      }
    }
    const result = await original.unlink(candidate);
    if (candidate === recovery && id === 'alice') {
      events.push('alice:release-recovery-guard'); gates.aliceGuardReleased.resolve();
    }
    return result;
  };
  fs.writeFile = async (candidate, ...args) => {
    const id = context.getStore();
    if (candidate === recovery && id === 'bob' && lateGuard) await gates.aliceGuardReleased.promise;
    try {
      const result = await original.writeFile(candidate, ...args);
      if (candidate === recovery && id) events.push(`${id}:acquire-recovery-guard`);
      if (candidate === lock && id === 'alice') {
        events.push('alice:acquire-main'); gates.aliceMainWritten.resolve();
      }
      return result;
    } catch (error) {
      if (candidate === recovery && id) events.push(`${id}:recovery-write-${error.code}`);
      throw error;
    }
  };
  fs.rename = async (source, destination) => {
    const id = context.getStore();
    if (destination === file && id === 'bob') await gates.aliceDone.promise;
    const result = await original.rename(source, destination);
    if (destination === file && id) events.push(`${id}:commit`);
    return result;
  };
  syncBuiltinESMExports();
  const opts = owner => ({ owner, statusProvider: name => official('status', '--change', name) });
  const alice = context.run('alice', () => claimChange(root, 'page', opts('alice')))
    .finally(() => { events.push('alice:claim-settled'); gates.aliceDone.resolve(); });
  pending.push(alice);
  // 仅使同进程 pid+startedAt 内容可区分；正确性调度由上述栅栏完成。
  await new Promise(resolve => setTimeout(resolve, 3));
  const bob = context.run('bob', () => claimChange(root, 'page', opts('bob')))
    .catch(error => {
      events.push(`bob:rejected:${error.message}`);
      gates.bobDecision.resolve(); gates.bothHashes.resolve();
      throw error;
    });
  pending.push(bob);
  const timeout = deferred();
  timer = setTimeout(() => {
    timedOut = true;
    for (const gate of Object.values(gates)) gate.resolve();
    timeout.resolve(null);
  }, 15000);
  let results = await Promise.race([Promise.allSettled(pending), timeout.promise]);
  if (results === null) results = await Promise.allSettled(pending);
  clearTimeout(timer);
  const after = await original.readFile(file, 'utf8');
  const finalOwner = after.match(/owner\): (.*)/u)?.[1];
  const summary = {
    lateGuard, timedOut, initialReads: [...initialReads], mainUnlinks: [...mainUnlinks],
    hashChecks: [...hashChecks], events,
    results: results.map(result => result.status === 'fulfilled'
      ? { status: result.status, value: result.value }
      : { status: result.status, error: result.reason.message }),
    finalOwner,
  };
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(timedOut, false, 'I/O 调度超时，不能将其当作通过');
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, '只允许一个 owner 认领');
  assert.equal(finalOwner, 'alice');
  await assert.rejects(() => fs.lstat(lock), { code: 'ENOENT' });
  await assert.rejects(() => fs.lstat(recovery), { code: 'ENOENT' });
} finally {
  clearTimeout(timer);
  for (const gate of Object.values(gates)) gate.resolve();
  await Promise.allSettled(pending);
  Object.assign(fs, original); syncBuiltinESMExports();
  await fs.rm(root, { recursive: true, force: true });
}
