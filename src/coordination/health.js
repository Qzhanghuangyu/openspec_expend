import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';
import { parseComate, parseTaskProgress, validateComateRecord } from './comate.js';
import { assertChangeSegment } from './naming.js';
import { resolveChange } from './resolver.js';
import { loadCoordination } from './store.js';

const FALLA_SCHEMAS = new Set(['falla-spec-driven', 'falla-task-driven']);
const MAX_RECORD_BYTES = 256 * 1024;

function issue(kind, change, related = undefined, count = undefined) {
  return {
    kind,
    change,
    ...(related ? { related } : {}),
    ...(count === undefined ? {} : { count }),
  };
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function safeLstat(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

export async function readChangeRecordFile(rootInput, changePath, filename, optional = false) {
  const root = await realpath(path.resolve(rootInput));
  const directoryEntry = await safeLstat(changePath);
  if (!directoryEntry || directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory()) {
    throw new FallaError(1, 'change 必须是项目内真实目录，不能是符号链接');
  }
  const directory = await realpath(changePath);
  if (!isInside(root, directory)) {
    throw new FallaError(1, 'change 路径越过项目边界');
  }

  const file = path.join(directory, filename);
  const entry = await safeLstat(file);
  if (!entry && optional) return null;
  if (!entry) return null;
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new FallaError(1, `${filename} 必须是普通文件，不能是符号链接`);
  }
  if (entry.size > MAX_RECORD_BYTES) {
    throw new FallaError(1, `${filename} 超过 256 KiB 限制`);
  }
  const resolved = await realpath(file);
  if (!isInside(directory, resolved)) {
    throw new FallaError(1, `${filename} 路径越过 change 边界`);
  }
  return readFile(resolved, 'utf8');
}

function comateReached(status) {
  const artifact = Array.isArray(status.artifacts)
    ? status.artifacts.find(({ id }) => id === 'comate')
    : null;
  return status.isPlanningComplete === true || artifact?.status === 'done';
}

async function readRecord(root, reference, officialStatus, errors) {
  let resolved;
  try {
    resolved = await resolveChange(root, reference);
  } catch (error) {
    if (!comateReached(officialStatus ?? {})) return null;
    errors.push(issue('missing-change', reference));
    return null;
  }

  const markdown = await readChangeRecordFile(root, resolved.path, 'comate.md', true);
  if (markdown === null) {
    if (comateReached(officialStatus ?? {})) errors.push(issue('missing-comate', reference));
    return null;
  }

  let comate;
  try {
    comate = parseComate(markdown, `${reference}/comate.md`);
  } catch {
    errors.push(issue('invalid-comate', reference));
    return null;
  }

  const tasksMarkdown = await readChangeRecordFile(root, resolved.path, 'tasks.md', true);
  if (tasksMarkdown === null) {
    errors.push(issue('missing-tasks', reference));
    return { reference, resolved, comate, tasks: null, officialStatus };
  }
  const tasks = parseTaskProgress(tasksMarkdown);
  for (const localIssue of validateComateRecord(comate, { pendingTasks: tasks.pending })) {
    const { kind, count, ...details } = localIssue;
    errors.push({
      ...issue(kind, reference, undefined, count),
      ...(Object.keys(details).length > 0 ? { details } : {}),
    });
  }
  if (comate.status === 'done' && officialStatus?.isPlanningComplete === false) {
    errors.push(issue('artifacts-incomplete', reference));
  }
  return { reference, resolved, comate, tasks, officialStatus };
}

export async function validateChangeRecords(root, statuses) {
  if (!Array.isArray(statuses)) throw new FallaError(1, '官方 status 必须是数组');
  const document = await loadCoordination(root);
  const physicalMappings = new Map(
    Object.entries(document.mappings).map(([logical, mapping]) => [mapping.physical, logical])
  );
  const childrenByParent = new Map();
  for (const [logical, mapping] of Object.entries(document.mappings)) {
    const entries = childrenByParent.get(mapping.parent) ?? [];
    entries.push(logical);
    childrenByParent.set(mapping.parent, entries);
  }

  const errors = [];
  const records = new Map();
  const officialByReference = new Map();
  for (const status of statuses) {
    if (!FALLA_SCHEMAS.has(status?.schemaName)) continue;
    const physical = assertChangeSegment(status.changeName, 'status.changeName');
    const mapped = physicalMappings.get(physical);
    const reference = mapped ?? physical;
    officialByReference.set(reference, status);

    if (status.schemaName === 'falla-task-driven' && !mapped) {
      errors.push(issue('unmapped-child', physical));
      continue;
    }
    if (status.schemaName === 'falla-spec-driven' && mapped) {
      errors.push(issue('schema-mode-conflict', reference));
    }

    const record = await readRecord(root, reference, status, errors);
    if (record) records.set(reference, record);
  }

  for (const [parent, children] of childrenByParent) {
    for (const logical of children.sort()) {
      if (records.has(logical)) continue;
      const record = await readRecord(root, logical, officialByReference.get(logical), errors);
      if (record) records.set(logical, record);
    }

    const parentRecord = records.get(parent);
    if (!parentRecord) continue;
    if (parentRecord.comate.executionMode === 'single') {
      errors.push(issue('execution-mode-conflict', parent));
    }
    if (parentRecord.comate.status === 'done') {
      for (const logical of children.sort()) {
        if (records.get(logical)?.comate.status !== 'done') {
          errors.push(issue('child-not-done', parent, logical));
        }
      }
    }
  }

  for (const [reference, record] of records) {
    if (record.officialStatus?.schemaName === 'falla-spec-driven'
      && record.comate.executionMode === 'parallel'
      && !(childrenByParent.get(reference)?.length > 0)) {
      errors.push(issue('execution-mode-conflict', reference));
    }
    if (record.officialStatus?.schemaName === 'falla-task-driven'
      && record.comate.executionMode !== undefined) {
      errors.push(issue('schema-mode-conflict', reference));
    }
  }

  return { ok: errors.length === 0, errors };
}
