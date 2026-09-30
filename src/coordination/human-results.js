import { FallaError } from '../errors.js';

const TASK_ID = /^(?:[1-9]\d*(?:\.[1-9]\d*)*|T[1-9]\d*)$/u;
const RESULTS = new Set(['pending', 'passed', 'failed']);
const MAX_RESULTS = 2048;

/** 只保存编号和人工结果；数组避免 JSON 对象的重复编号键被静默覆盖。 */
export function parseHumanTaskResults(value) {
  let entries;
  try { entries = JSON.parse(value); } catch { throw new FallaError(1, 'human-task-results 必须是有效的任务结果 JSON'); }
  if (!Array.isArray(entries) || entries.length > MAX_RESULTS) {
    throw new FallaError(1, 'human-task-results 必须是最多 2048 项的任务结果数组');
  }
  const ids = new Set();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2
      || typeof entry[0] !== 'string' || entry[0].length > 64 || !TASK_ID.test(entry[0])
      || !RESULTS.has(entry[1]) || ids.has(entry[0])) {
      throw new FallaError(1, 'human-task-results 编号或结果无效、重复或含额外字段');
    }
    ids.add(entry[0]);
  }
  return entries;
}

/** 只核对真实任务与结果一致，不验证人工结果真实性，也不要求材料或逐项基线。 */
export function validateHumanTaskResults(record, { taskStates, humanTasks }) {
  if (!Array.isArray(taskStates)) {
    return humanTasks > 0 || record.validationMode === 'human' || record.humanTaskResults?.length > 0
      ? [{ kind: 'human-task-state-required' }] : [];
  }
  const results = new Map(record.humanTaskResults ?? []);
  const manual = task => task.human || record.validationMode === 'human';
  const byId = new Map();
  const ambiguous = new Set();
  for (const task of taskStates) {
    if (task.id === null) continue;
    const previous = byId.get(task.id);
    // 旧围栏里的显式编号也参与人工结果关联；歧义不允许覆盖或共用一个通过结果。
    if (previous && (manual(previous) || manual(task) || results.has(task.id))) ambiguous.add(task.id);
    if (!previous) byId.set(task.id, task);
  }
  const issues = [...ambiguous].map(task => ({ kind: 'human-task-id-ambiguous', task }));
  for (const [id] of results) {
    if (ambiguous.has(id)) continue;
    const task = byId.get(id);
    if (!task) issues.push({ kind: 'human-task-result-unknown', task: id });
    else if (!manual(task)) issues.push({ kind: 'human-task-result-not-human', task: id });
  }
  for (const task of taskStates) {
    if (!manual(task) || !task.done) continue;
    if (task.id === null) issues.push({ kind: 'human-task-id-required' });
    else if (!ambiguous.has(task.id) && results.get(task.id) !== 'passed') {
      issues.push({ kind: 'human-task-result-required', task: task.id });
    }
  }
  return issues;
}
