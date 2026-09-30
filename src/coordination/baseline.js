import { createHash } from 'node:crypto';
import { FallaError } from '../errors.js';
import { taskDefinitions } from './tasks.js';

const MAX_BYTES = 256 * 1024;
const MAX_TASKS = 2048;
const HASH = /^[a-f0-9]{64}$/u;
const TASK_ID = /^(?:[1-9]\d*(?:\.[1-9]\d*)*|T[1-9]\d*)$/u;
const SOURCE_IDS = new Set([
  'preflight', 'proposal', 'design', 'prd', 'designSource', 'config', 'specs', 'spec',
  'coordination', 'parentTasks', 'parentContract', 'dependencies',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const issue = (kind, task = undefined) => ({ kind, ...(task ? { task } : {}) });
const validTask = id => typeof id === 'string' && id.length <= 64 && TASK_ID.test(id);

export function baselineError(kind = 'baseline-invalid') {
  const error = new FallaError(1, '实施基线未核验或需要复核；请核对基线记录与任务影响范围', { kind });
  error.kind = kind;
  return error;
}

// 只消除可明确视为排版的差异；代码块的缩进、空行、行尾空格不应隐式丢失。
function normalize(markdown, checkboxes = false) {
  if (markdown === null) return null;
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_BYTES) throw baselineError();
  let fence = null;
  const lines = markdown.replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n').split('\n');
  const headerEnd = lines[0] === '---' ? lines.findIndex((line, index) => index > 0 && line === '---') : -1;
  const result = [];
  for (const [index, original] of lines.entries()) {
    let line = original;
    const delimiter = line.match(/^\s*(`{3,}|~{3,})(.*)$/u);
    const inCode = fence !== null || delimiter !== null || /^(?: {4}|\t)/u.test(line);
    const significant = inCode || (headerEnd > 0 && index <= headerEnd) || /(?: {2}|\\)$/u.test(line);
    if (delimiter) {
      if (fence === null) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
    }
    if (!significant) {
      line = line.replace(/[ \t]+$/u, '');
      if (!line.trim()) continue;
    }
    if (checkboxes && fence === null && delimiter === null) line = line.replace(/^(\s*[-*]\s*)\[[\sxX]\]/u, '$1[ ]');
    result.push(line);
  }
  return result.join('\n');
}

/** 来源和任务摘要仅保存 hash；checkbox 是进度而不是完成条件的一部分。 */
export function baselineTaskState(markdown) {
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_BYTES) throw baselineError();
  const definitions = taskDefinitions(markdown);
  if (definitions.length > MAX_TASKS) throw baselineError();
  const ids = new Set();
  const tasks = definitions.map(({ id, done, human, content, inCode }) => {
    if (id !== null && (!validTask(id) || ids.has(id))) throw baselineError();
    if (id !== null) ids.add(id);
    return { id, done, human, hash: digest(normalize(content, !inCode)) };
  });
  return { tasks, complete: tasks.filter(task => task.done).length, anonymous: tasks.filter(task => task.id === null).length };
}

export function createBaselineSnapshot(sources, tasksMarkdown) {
  if (!object(sources) || Object.keys(sources).length > 32) throw baselineError();
  const entries = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([key]) => !SOURCE_IDS.has(key))) throw baselineError();
  const sourcesById = Object.fromEntries(entries.map(([key, value]) => [key, digest(normalize(value, key === 'parentTasks'))]));
  sourcesById.tasks = digest(normalize(tasksMarkdown, true));
  const state = baselineTaskState(tasksMarkdown);
  const tasks = Object.fromEntries(state.tasks.filter(task => task.id !== null).map(task => [task.id, task.hash]));
  const body = { version: 1, sources: sourcesById, tasks };
  return { ...body, fingerprint: digest(body) };
}

function validateSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.version !== 1 || !HASH.test(snapshot.fingerprint)
    || !object(snapshot.sources) || !object(snapshot.tasks)
    || Object.keys(snapshot).sort().join(',') !== 'fingerprint,sources,tasks,version'
    || Object.keys(snapshot.sources).length > 32 || Object.keys(snapshot.tasks).length > MAX_TASKS
    || Object.entries(snapshot.sources).some(([id, hash]) => (!SOURCE_IDS.has(id) && id !== 'tasks') || typeof hash !== 'string' || !HASH.test(hash))
    || Object.entries(snapshot.tasks).some(([id, hash]) => !validTask(id) || typeof hash !== 'string' || !HASH.test(hash))) throw baselineError();
  const { version, sources, tasks, fingerprint } = snapshot;
  if (fingerprint !== digest({ version, sources, tasks })) throw baselineError();
  return snapshot;
}

function validReview(review) {
  return object(review) && Object.keys(review).sort().join(',') === 'affected,evidence,from,preserved,to'
    && (review.from === null || (typeof review.from === 'string' && HASH.test(review.from)))
    && typeof review.to === 'string' && HASH.test(review.to)
    && Array.isArray(review.affected) && Array.isArray(review.preserved)
    && review.affected.length + review.preserved.length <= MAX_TASKS
    && [...review.affected, ...review.preserved].every(validTask)
    && typeof review.evidence === 'string' && review.evidence.trim().length > 0 && Buffer.byteLength(review.evidence) <= 4096;
}

function readField(markdown, name, label, empty) {
  const matches = [...markdown.replace(/^\uFEFF/u, '').matchAll(new RegExp(`^- ${label} \\(${name}\\):[ \\t]*(.*)$`, 'gmu'))];
  if (matches.length > 1) throw baselineError();
  if (!matches.length || matches[0][1].trim() === empty) return null;
  try {
    const value = JSON.parse(matches[0][1]);
    if (value === null) throw baselineError();
    return value;
  } catch { throw baselineError(); }
}

export function readBaselineFields(markdown) {
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_BYTES) throw baselineError();
  const snapshot = readField(markdown, 'baseline', '实施基线', 'unrecorded');
  const review = readField(markdown, 'baseline-review', '基线复核', 'none');
  if (snapshot !== null) validateSnapshot(snapshot);
  if (review !== null && !validReview(review)) throw baselineError();
  return { snapshot, review };
}

export function writeBaselineField(markdown, snapshot) {
  validateSnapshot(snapshot);
  readBaselineFields(markdown);
  const prefix = markdown.startsWith('\uFEFF') ? '\uFEFF' : '';
  markdown = markdown.replace(/^\uFEFF/u, '');
  const field = `- 实施基线 (baseline): ${JSON.stringify(snapshot)}`;
  const result = prefix + ( /^- 实施基线 \(baseline\):/mu.test(markdown)
    ? markdown.replace(/^- 实施基线 \(baseline\):.*$/mu, field)
    : `${field}\n${markdown}`);
  if (Buffer.byteLength(result) > MAX_BYTES) throw baselineError();
  return result;
}

export function baselineIssues(previous, current, record, progress) {
  if (!previous) {
    return record.status !== 'todo' || progress.complete > 0 || record.humanReview === 'passed'
      || record.humanTaskResults?.some(([, result]) => result === 'passed')
      ? [issue('baseline-unverified')] : [];
  }
  return previous.fingerprint === current.fingerprint ? [] : [issue('baseline-review-required')];
}

/** 结构化影响清单不代替语义判断：仅校验版本、已完成保留项和受影响回退的一致性。 */
export function validateBaselineReview(previous, current, review, state, record, taskStates = []) {
  if (!validReview(review) || review.from !== (previous?.fingerprint ?? null) || review.to !== current.fingerprint
    || state.anonymous > 0) return [issue('baseline-review-invalid')];
  const affected = new Set(review.affected);
  const preserved = new Set(review.preserved);
  if (affected.size !== review.affected.length || preserved.size !== review.preserved.length
    || [...affected].some(id => preserved.has(id))) return [issue('baseline-review-invalid')];
  const known = new Set([...Object.keys(previous?.tasks ?? {}), ...Object.keys(current.tasks)]);
  if ([...affected, ...preserved].some(id => !known.has(id))) return [issue('baseline-review-invalid')];
  const errors = [];
  const manualResults = new Map(record.humanTaskResults ?? []);
  const manualTaskIds = new Set(taskStates.filter(task => task.human).map(task => task.id));
  // 结果关联采用进度解析的人工归属；即使基线正文归属不同，affected 也不能保留旧 passed。
  for (const id of affected) {
    if (manualResults.get(id) === 'passed') errors.push(issue('baseline-human-task-result-not-reverted', id));
  }
  for (const task of state.tasks) {
    if (!affected.has(task.id) && !preserved.has(task.id)) errors.push(issue('baseline-task-unreviewed', task.id));
    if (affected.has(task.id) && task.done) errors.push(issue('baseline-task-not-reverted', task.id));
    if (preserved.has(task.id) && previous && previous.tasks[task.id] !== current.tasks[task.id]) {
      errors.push(issue('baseline-task-changed', task.id));
    }
    if (affected.has(task.id) && (task.human || manualTaskIds.has(task.id) || record.validationMode === 'human')
      && record.humanReview !== 'pending') errors.push(issue('baseline-human-review-required', task.id));
  }
  for (const id of Object.keys(previous?.tasks ?? {})) {
    if (!Object.hasOwn(current.tasks, id) && !affected.has(id)) errors.push(issue('baseline-task-unreviewed', id));
  }
  if (affected.size > 0 && record.status === 'done') errors.push(issue('baseline-status-not-reverted'));
  return errors;
}
