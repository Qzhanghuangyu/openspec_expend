import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { FallaError } from '../errors.js';
import { sha256, writeAtomicFile } from '../install/files.js';
import { withProjectLock } from '../locks.js';
import { loadBaselineState } from './baseline-files.js';
import { handoffFieldHasValue, parseComate } from './comate.js';
import { validateCoordination } from './dag.js';
import { readChangeRecordFile } from './record-files.js';
import { resolveChange } from './resolver.js';
import { loadCoordination, loadCoordinationSnapshot } from './store.js';
import { assertOwner } from './owner.js';

const TRANSITION_STATUSES = new Set(['blocked', 'in-progress', 'done']);
const FIELD_PATTERNS = {
  owner: /^(- 负责人 \(owner\):)[ \t]*[^\r\n]*$/gm,
  status: /^(- 状态 \(status\):)[ \t]*[^\r\n]*$/gm,
};

function replaceField(markdown, field, value) {
  let count = 0;
  const updated = markdown.replace(FIELD_PATTERNS[field], (_, prefix) => {
    count += 1;
    return `${prefix} ${value}`;
  });
  if (count !== 1) throw new FallaError(1, '父协作记录的认领字段无效');
  return updated;
}

/** 协调权仅来自父 comate；不能由子物理名、候选负责人或进程 PID 推导。 */
async function ownedParent(root, reference, owner) {
  const resolved = await resolveChange(root, reference);
  if (resolved.parent) throw new FallaError(1, '协调命令仅接受 parallel 父 change，不接受子引用');
  if (resolved.lifecycle !== 'active') throw new FallaError(1, '已归档父 change 不允许更新协调状态');
  const markdown = await readChangeRecordFile(root, resolved.path, 'comate.md');
  let record;
  try { record = parseComate(markdown); } catch { throw new FallaError(1, '父协作记录无效'); }
  const document = await loadCoordination(root);
  if (record.executionMode !== 'parallel'
    || !Object.values(document.mappings).some(mapping => mapping.parent === resolved.physical)) {
    throw new FallaError(1, '协调命令仅接受有子映射的 parallel 父 change');
  }
  if (record.owner === 'unassigned' || record.status === 'todo') {
    throw new FallaError(1, '父协调者尚未认领，请先显式 claim --coordinator');
  }
  if (record.owner !== owner) throw new FallaError(1, '仅当前父 owner/负责人可更新协调记录');
  return { resolved, markdown, record };
}

function cachedStatusProvider(provider) {
  if (typeof provider !== 'function') throw new FallaError(1, '协调操作缺少官方 status provider');
  const statuses = new Map();
  return physical => {
    if (!statuses.has(physical)) statuses.set(physical, provider(physical));
    return statuses.get(physical);
  };
}

async function assertOfficial(state, statusProvider, requirePlanning) {
  const official = await statusProvider(state.resolved.physical);
  if (official?.changeName !== state.resolved.physical || official.schemaName !== 'falla-spec-driven') {
    throw new FallaError(1, '官方 status 与 parallel 父协调模式不一致');
  }
  if (requirePlanning && official.isPlanningComplete !== true) {
    throw new FallaError(1, '父官方规划未完成，不能恢复或完成');
  }
}

async function writeParent(root, state, updated, expected) {
  // 超限或结构无效须在落盘前拒绝，不能先改 owner 再在读回复核时报错。
  try { parseComate(updated); } catch { throw new FallaError(1, '父协作记录更新无效或超过大小限制'); }
  const relative = path.relative(root, path.join(state.resolved.path, 'comate.md')).split(path.sep).join('/');
  await writeAtomicFile(root, relative, updated, { expectedHash: sha256(state.markdown) });
  const verified = parseComate(await readChangeRecordFile(root, state.resolved.path, 'comate.md'));
  if (verified.owner !== expected.owner || verified.status !== expected.status) {
    throw new FallaError(1, '父协调记录写入复核失败');
  }
}

/** 暂停不批准旧证据；恢复/完成则锁内验证候选父状态和最新输入，不自动重勾任何任务。 */
export async function transitionParent(rootInput, reference, options = {}) {
  const owner = assertOwner(options.owner);
  const status = options.status;
  if (!TRANSITION_STATUSES.has(status)) throw new FallaError(1, '父协调目标状态仅支持 blocked/in-progress/done');
  return withProjectLock(rootInput, 'coordination', async () => {
    const root = await realpath(path.resolve(rootInput));
    const state = await ownedParent(root, reference, owner);
    if (status === 'blocked') {
      // 基线或下游不一致时仍须先阻断新执行；子 owner 分别暂停自己的活动记录。
      if (!handoffFieldHasValue(state.record.handoff, '遗留风险与恢复条件')) {
        throw new FallaError(1, '父暂停须先填写 handoff 的遗留风险与恢复条件');
      }
    } else {
      const statusProvider = cachedStatusProvider(options.statusProvider);
      await assertOfficial(state, statusProvider, true);
      const baseline = await loadBaselineState(root, reference);
      if (baseline.errors.length > 0) throw new FallaError(1, '父实施基线失效或未核验，不能恢复或完成');
      const inputSnapshot = { files: new Map() };
      const validation = await validateCoordination(root, {
        change: state.resolved.physical, statusProvider, parentState: { status }, inputSnapshot,
      });
      if (!validation.ok) throw new FallaError(1, '父协调完成/恢复验证门禁未通过');
      const latest = await loadBaselineState(root, reference);
      if (latest.markdown !== state.markdown || latest.tasksMarkdown !== baseline.tasksMarkdown
        || latest.current.fingerprint !== baseline.current.fingerprint) {
        throw new FallaError(1, '父协调输入已发生变化，拒绝覆盖');
      }
      if ((await loadCoordinationSnapshot(root)).hash !== inputSnapshot.coordinationHash) {
        throw new FallaError(1, '父协作映射已发生变化，拒绝覆盖');
      }
      for (const input of inputSnapshot.files.values()) {
        if (sha256(await readChangeRecordFile(root, input.resolved.path, 'comate.md')) !== input.comateHash
          || sha256(await readChangeRecordFile(root, input.resolved.path, 'tasks.md')) !== input.tasksHash) {
          throw new FallaError(1, '父子协调输入已发生变化，拒绝覆盖');
        }
      }
    }
    if (state.record.status === status) {
      return { change: state.resolved.logical, role: 'coordinator', status, changed: false, idempotent: true };
    }
    await writeParent(root, state, replaceField(state.markdown, 'status', status), { owner, status });
    return { change: state.resolved.logical, role: 'coordinator', status, changed: true, idempotent: false };
  });
}

/** 用户批准的身份交接不追认进度；允许新负责人接手失效基线的恢复，但不清空或刷新证据。 */
export async function transferParent(rootInput, reference, options = {}) {
  const owner = assertOwner(options.owner);
  const to = assertOwner(options.to);
  if (to === owner) throw new FallaError(1, '交接目标 owner 必须不同于当前负责人');
  return withProjectLock(rootInput, 'coordination', async () => {
    const root = await realpath(path.resolve(rootInput));
    const state = await ownedParent(root, reference, owner);
    await assertOfficial(state, cachedStatusProvider(options.statusProvider), false);
    if (!handoffFieldHasValue(state.record.handoff, '下一步准确操作')) {
      throw new FallaError(1, '父交接须先在 handoff 的下一步准确操作记录确认依据和接手操作');
    }
    await writeParent(root, state, replaceField(state.markdown, 'owner', to), { owner: to, status: state.record.status });
    return { change: state.resolved.logical, role: 'coordinator', status: state.record.status, transferred: true };
  });
}
