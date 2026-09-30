import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseComate, parseTaskProgress } from './comate.js';
import { baselineError, baselineIssues, baselineTaskState, createBaselineSnapshot, readBaselineFields } from './baseline.js';
import { assertRecordDirectory, readChangeRecordFile } from './record-files.js';
import { resolveChange } from './resolver.js';
import { loadCoordination } from './store.js';
import { assertChangeSegment, parseLogicalReference } from './naming.js';

const PUBLIC_FILES = {
  preflight: 'preflight.md', proposal: 'proposal.md', design: 'design.md',
  prd: 'prd-source.md', designSource: 'design-source.md', config: '.openspec.yaml',
};

async function specificationSource(root, directory) {
  const base = path.join(directory, 'specs');
  try { await lstat(base); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const files = [];
  const queue = [base];
  let directories = 0;
  let bytes = 0;
  for (const folder of queue) {
    if (++directories > 128) throw baselineError('baseline-unreadable');
    await assertRecordDirectory(root, folder);
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw baselineError('baseline-unreadable');
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) queue.push(target);
      else if (entry.name.endsWith('.md')) {
        if (!entry.isFile() || files.length >= 64) throw baselineError('baseline-unreadable');
        const text = await readChangeRecordFile(root, folder, entry.name);
        bytes += Buffer.byteLength(text);
        if (bytes > 2 * 1024 * 1024) throw baselineError('baseline-unreadable');
        // 仅规格清单和逐文件摘要参与基线，不把规格正文带回调用方或错误输出。
        const hash = createBaselineSnapshot({ spec: text }, '').sources.spec;
        files.push([path.relative(base, target).split(path.sep).join('/'), hash]);
      }
    }
  }
  return JSON.stringify(files.sort(([a], [b]) => a.localeCompare(b)));
}

function contract(record, canonical) {
  return { mode: record.executionMode ?? null, validation: record.validationMode ?? null,
    dependencies: record.dependsOn.map(canonical).sort() };
}

/** 交付版本绑定可达显式上游；子节点的父只提供上下文，不虚构“父必须先 done”的依赖边。 */
async function dependencyVersions(root, initial, mappings, canonical, target) {
  const queue = initial.map(reference => ({ reference: canonical(reference), delivery: true }));
  const visited = new Set();
  const fingerprints = new Map();
  for (const item of queue) {
    const { reference, delivery } = item;
    const key = `${reference}:${delivery}`;
    if (reference === target || visited.has(key)) continue;
    visited.add(key);
    if (visited.size > 512) throw baselineError('baseline-unreadable');
    let resolved;
    try { resolved = await resolveChange(root, reference); } catch {
      fingerprints.set(reference, null);
      continue; // 缺失节点仍由 DAG 门禁报告；不伪造该节点的证据版本。
    }
    const text = await readChangeRecordFile(root, resolved.path, 'comate.md', true);
    if (text === null) { fingerprints.set(reference, null); continue; }
    const record = parseComate(text);
    fingerprints.set(reference, readBaselineFields(text).snapshot?.fingerprint ?? null);
    for (const dependency of record.dependsOn) queue.push({ reference: canonical(dependency), delivery: true });
    const mapping = mappings[reference];
    if (mapping) queue.push({ reference: mapping.parent, delivery: false });
    else if (delivery) {
      // 父交付隐含依赖子交付；父仅作为子上下文时不让无关兄弟版本反向影响当前任务。
      for (const [logical, child] of Object.entries(mappings)) {
        if (child.parent === reference) queue.push({ reference: logical, delivery: true });
      }
    }
  }
  const entries = [...fingerprints].sort(([left], [right]) => left.localeCompare(right));
  return { source: JSON.stringify(entries), references: entries.map(([reference]) => reference) };
}

/** 实际输入在内存中读取后立即摘要；子引用归一到同一父的公共需求和设计。 */
export async function loadBaselineState(root, reference) {
  const mappings = (await loadCoordination(root)).mappings;
  const logicalByPhysical = new Map(Object.entries(mappings).map(([logical, item]) => [item.physical, logical]));
  const canonical = ref => logicalByPhysical.get(ref) ?? ref;
  reference = canonical(reference);
  const mapping = mappings[reference];
  const resolved = await resolveChange(root, reference);
  const parent = mapping ? await resolveChange(root, mapping.parent) : resolved;
  const markdown = await readChangeRecordFile(root, resolved.path, 'comate.md');
  const tasksMarkdown = await readChangeRecordFile(root, resolved.path, 'tasks.md');
  if (markdown === null || tasksMarkdown === null) throw baselineError('baseline-unreadable');
  const record = parseComate(markdown);
  const { snapshot, review } = readBaselineFields(markdown);
  const sources = {};
  for (const [key, file] of Object.entries(PUBLIC_FILES)) sources[key] = await readChangeRecordFile(root, parent.path, file, true);
  sources.specs = await specificationSource(root, parent.path);
  sources.coordination = JSON.stringify(contract(record, canonical));
  let parentDependencies = [];
  if (mapping) {
    sources.parentTasks = await readChangeRecordFile(root, parent.path, 'tasks.md');
    // 父任务由共用归一化器处理真实 checkbox，代码字面标记仍参与证据版本。
    const parentMarkdown = await readChangeRecordFile(root, parent.path, 'comate.md');
    if (parentMarkdown === null) throw baselineError('baseline-unreadable');
    const parentRecord = parseComate(parentMarkdown);
    parentDependencies = parentRecord.dependsOn;
    sources.parentContract = JSON.stringify(contract(parentRecord, canonical));
  }
  const versions = await dependencyVersions(root, [...record.dependsOn, ...parentDependencies], mappings, canonical, resolved.logical);
  sources.dependencies = versions.source;
  const current = createBaselineSnapshot(sources, tasksMarkdown);
  const progress = parseTaskProgress(tasksMarkdown);
  const state = baselineTaskState(tasksMarkdown);
  const errors = baselineIssues(snapshot, current, record, progress);
  return { root, resolved, parent, markdown, tasksMarkdown, record, snapshot, review, current, progress, state, errors, dependencyReferences: versions.references };
}

export function baselineReport(state) {
  const previous = state.snapshot;
  const sources = Object.keys(state.current.sources).filter(id => previous && state.current.sources[id] !== previous.sources[id]);
  const tasks = [...new Set([...Object.keys(previous?.tasks ?? {}), ...Object.keys(state.current.tasks)])]
    .filter(id => previous && state.current.tasks[id] !== previous.tasks[id]);
  return { ok: state.errors.length === 0, change: state.resolved.logical, parent: state.parent.physical,
    recorded: previous, current: state.current, changedSources: sources, changedTasks: tasks,
    errors: state.errors.map(error => ({ ...error, change: state.resolved.logical })) };
}

export async function inspectBaseline(root, reference) {
  if (typeof reference === 'string' && reference.includes('/')) parseLogicalReference(reference);
  else assertChangeSegment(reference);
  try { return baselineReport(await loadBaselineState(root, reference)); } catch (error) {
    return { ok: false, change: reference, errors: [{ kind: error.kind === 'baseline-invalid' ? error.kind : 'baseline-unreadable', change: reference }] };
  }
}
