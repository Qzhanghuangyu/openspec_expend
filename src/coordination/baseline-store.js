import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { FallaError } from '../errors.js';
import { sha256, writeAtomicFile } from '../install/files.js';
import { withProjectLock } from '../locks.js';
import { baselineError, validateBaselineReview, writeBaselineField } from './baseline.js';
import { inspectBaseline, loadBaselineState } from './baseline-files.js';
import { validateComateRecord } from './comate.js';
import { checkPreflight } from './health.js';
import { assertOwner } from './owner.js';
import { validateCoordination } from './dag.js';

/** 仅记录调用方基线；回退、保留理由和其他 owner 的状态由原负责人先显式维护。 */
export async function recordBaseline(rootInput, reference, options = {}) {
  const owner = assertOwner(options.owner);
  return withProjectLock(rootInput, 'coordination', async () => {
    const root = await realpath(path.resolve(rootInput));
    let state;
    try { state = await loadBaselineState(root, reference); } catch { throw baselineError('baseline-unreadable'); }
    if (state.resolved.lifecycle !== 'active') throw new FallaError(1, '已归档 change 不允许更新基线；请规划新 change');
    if (state.record.owner !== 'unassigned' && state.record.owner !== owner) {
      throw new FallaError(1, '基线仅可由当前 owner/负责人复核，不覆盖他人记录');
    }
    if (!(await checkPreflight(root, state.parent.physical)).ok) throw new FallaError(1, 'Preflight 准入未通过，不能记录实施基线');
    const local = validateComateRecord(state.record, { pendingTasks: state.progress.pending, humanTasks: state.progress.humanTasks, taskIssues: state.progress.issues });
    if (local.length > 0) throw baselineError('baseline-record-invalid');
    if (state.errors.length > 0 && validateBaselineReview(state.snapshot, state.current, state.review, state.state, state.record).length > 0) {
      throw baselineError('baseline-review-required');
    }
    const validation = await validateCoordination(root, { change: state.parent.physical, ignoreBaseline: true });
    if (!validation.ok) throw baselineError('baseline-coordination-invalid');
    for (const reference of state.dependencyReferences) {
      if (!(await inspectBaseline(root, reference)).ok) throw baselineError('baseline-dependency-unverified');
    }
    if (state.snapshot?.fingerprint === state.current.fingerprint) {
      return { ok: true, change: state.resolved.logical, recorded: false, fingerprint: state.current.fingerprint };
    }
    const latest = await loadBaselineState(root, reference);
    if (latest.markdown !== state.markdown || latest.tasksMarkdown !== state.tasksMarkdown
      || latest.current.fingerprint !== state.current.fingerprint) throw baselineError('baseline-input-changed');
    const updated = writeBaselineField(state.markdown, state.current);
    const relative = path.relative(root, path.join(state.resolved.path, 'comate.md')).split(path.sep).join('/');
    await writeAtomicFile(root, relative, updated, { expectedHash: sha256(state.markdown) });
    return { ok: true, change: state.resolved.logical, recorded: true, fingerprint: state.current.fingerprint };
  });
}
