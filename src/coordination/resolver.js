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

async function occupiedPhysicalNames(root) {
  const changes = path.join(path.resolve(root), 'openspec', 'changes');
  const occupied = new Set();
  try {
    for (const entry of await readdir(changes, { withFileTypes: true })) {
      if (entry.name !== 'archive') occupied.add(entry.name);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }
  try {
    for (const entry of await readdir(path.join(changes, 'archive'), { withFileTypes: true })) {
      const match = entry.name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
      if (match) occupied.add(match[1]);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }
  return occupied;
}

async function physicalChangeExists(root, physical) {
  return (await occupiedPhysicalNames(root)).has(physical);
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

  const occupied = await occupiedPhysicalNames(root);
  for (const mapping of Object.values(snapshot.document.mappings)) occupied.add(mapping.physical);
  const physical = toPhysicalName(parsed.parent, parsed.child, occupied);
  const document = structuredClone(snapshot.document);
  document.mappings[parsed.logical] = { physical, parent: parsed.parent };
  await saveCoordination(root, document, { expectedHash: snapshot.hash });
  return { logical: parsed.logical, physical, parent: parsed.parent, created: true };
}

export async function unregisterMapping(root, reference) {
  const parsed = parseLogicalReference(reference);
  const snapshot = await loadCoordinationSnapshot(root);
  const mapping = snapshot.document.mappings[parsed.logical];
  if (!mapping) throw new FallaError(1, `找不到逻辑 change 映射：${parsed.logical}`);
  if (await physicalChangeExists(root, mapping.physical)) {
    throw new FallaError(1, `物理 change 已存在，拒绝移除映射：${mapping.physical}`);
  }

  const document = structuredClone(snapshot.document);
  delete document.mappings[parsed.logical];
  await saveCoordination(root, document, { expectedHash: snapshot.hash });
  return {
    logical: parsed.logical,
    physical: mapping.physical,
    parent: mapping.parent,
    removed: true,
  };
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
