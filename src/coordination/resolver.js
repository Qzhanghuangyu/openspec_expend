import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';
import {
  assertChangeSegment,
  parseLogicalReference,
  toPhysicalName,
} from './naming.js';
import {
  loadCoordination,
  loadCoordinationSnapshot,
  saveCoordination,
} from './store.js';

async function directoryEntry(candidate) {
  try {
    const entry = await lstat(candidate);
    if (entry.isSymbolicLink()) {
      throw new FallaError(1, `change 目录不能是符号链接：${candidate}`);
    }
    return entry.isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function locateChange(root, physical) {
  const changes = path.join(path.resolve(root), 'openspec', 'changes');
  const active = path.join(changes, physical);
  const activeExists = await directoryEntry(active);
  const archive = path.join(changes, 'archive');
  let archived = [];
  try {
    const pattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRegExp(physical)}$`);
    archived = (await readdir(archive, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => path.join(archive, entry.name));
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }

  if (activeExists && archived.length > 0) {
    throw new FallaError(1, `change 同时存在于 active 和 archive：${physical}`);
  }
  if (archived.length > 1) {
    throw new FallaError(1, `发现多个归档 change：${physical}`);
  }
  if (activeExists) return { path: active, lifecycle: 'active' };
  if (archived.length === 1) return { path: archived[0], lifecycle: 'archived' };
  throw new FallaError(1, `找不到物理 change：${physical}`);
}

export async function registerMapping(root, reference) {
  const parsed = parseLogicalReference(reference);
  const parentPath = path.join(path.resolve(root), 'openspec', 'changes', parsed.parent);
  if (!await directoryEntry(parentPath)) {
    throw new FallaError(1, `父 change 不存在：${parsed.parent}`);
  }

  const snapshot = await loadCoordinationSnapshot(root);
  const existing = snapshot.document.mappings[parsed.logical];
  if (existing) {
    return { logical: parsed.logical, ...existing, created: false };
  }

  const occupied = new Set(Object.values(snapshot.document.mappings).map(({ physical }) => physical));
  const physical = toPhysicalName(parsed.parent, parsed.child, occupied);
  const document = structuredClone(snapshot.document);
  document.mappings[parsed.logical] = { physical, parent: parsed.parent };
  await saveCoordination(root, document, { expectedHash: snapshot.hash });
  return { logical: parsed.logical, physical, parent: parsed.parent, created: true };
}

export async function resolveChange(root, reference) {
  let logical = reference;
  let physical;
  let parent = null;
  if (String(reference).includes('/')) {
    const parsed = parseLogicalReference(reference);
    const document = await loadCoordination(root);
    const mapping = document.mappings[parsed.logical];
    if (!mapping) throw new FallaError(1, `找不到逻辑 change 映射：${parsed.logical}`);
    logical = parsed.logical;
    physical = mapping.physical;
    parent = mapping.parent;
  } else {
    physical = assertChangeSegment(reference, 'change');
  }

  const located = await locateChange(root, physical);
  return { logical, physical, parent, ...located };
}
