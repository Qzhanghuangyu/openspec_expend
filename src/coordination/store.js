import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { FallaError } from '../errors.js';
import { assertChangeSegment, parseLogicalReference } from './naming.js';

const MAX_COORDINATION_BYTES = 1024 * 1024;

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

async function assertSafeParent(root, create = false) {
  const resolvedRoot = await realpath(path.resolve(root));
  const directory = path.join(resolvedRoot, '.falla');
  let entry = await safeLstat(directory);
  if (!entry && create) {
    await mkdir(directory, { recursive: false });
    entry = await safeLstat(directory);
  }
  if (!entry) return { resolvedRoot, directory };
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new FallaError(1, '.falla 必须是项目内真实目录，不能是符号链接');
  }
  const resolvedDirectory = await realpath(directory);
  if (!isInside(resolvedRoot, resolvedDirectory)) {
    throw new FallaError(1, '.falla 路径越过项目边界');
  }
  return { resolvedRoot, directory: resolvedDirectory };
}

export function assertCoordinationDocument(document) {
  if (!isRecord(document) || document.version !== 1 || !isRecord(document.mappings)) {
    throw new FallaError(1, 'coordination.yaml 必须包含 version: 1 和 mappings 对象');
  }

  const physicalNames = new Set();
  for (const [logical, mapping] of Object.entries(document.mappings)) {
    const reference = parseLogicalReference(logical);
    if (!isRecord(mapping)) throw new FallaError(1, `映射无效：${logical}`);
    assertChangeSegment(mapping.physical, `${logical}.physical`);
    if (mapping.parent !== reference.parent) {
      throw new FallaError(1, `映射 parent 与逻辑引用不一致：${logical}`);
    }
    if (physicalNames.has(mapping.physical)) {
      throw new FallaError(1, `多个逻辑 change 指向同一物理名：${mapping.physical}`);
    }
    physicalNames.add(mapping.physical);
  }
  return document;
}

export async function loadCoordinationSnapshot(root) {
  const { directory } = await assertSafeParent(root);
  const file = path.join(directory, 'coordination.yaml');
  const entry = await safeLstat(file);
  if (!entry) {
    return { document: { version: 1, mappings: {} }, hash: null };
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new FallaError(1, 'coordination.yaml 必须是普通文件，不能是符号链接');
  }
  if (entry.size > MAX_COORDINATION_BYTES) {
    throw new FallaError(1, 'coordination.yaml 超过 1 MiB 限制');
  }

  const content = await readFile(file, 'utf8');
  let document;
  try {
    document = YAML.parse(content, { maxAliasCount: 100 });
  } catch {
    throw new FallaError(1, 'coordination.yaml 不是有效 YAML');
  }
  return { document: assertCoordinationDocument(document), hash: hash(content) };
}

export async function loadCoordination(root) {
  return (await loadCoordinationSnapshot(root)).document;
}

async function currentHash(file) {
  const entry = await safeLstat(file);
  if (!entry) return null;
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new FallaError(1, 'coordination.yaml 必须是普通文件，不能是符号链接');
  }
  return hash(await readFile(file));
}

export async function saveCoordination(root, document, options = {}) {
  assertCoordinationDocument(document);
  const { directory } = await assertSafeParent(root, true);
  const file = path.join(directory, 'coordination.yaml');
  const expectedHash = options.expectedHash;
  if (expectedHash !== undefined && await currentHash(file) !== expectedHash) {
    throw new FallaError(1, 'coordination.yaml 已被并发修改，拒绝覆盖');
  }

  const content = YAML.stringify(document, { lineWidth: 0 });
  const temporary = path.join(directory, `.coordination.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (expectedHash !== undefined && await currentHash(file) !== expectedHash) {
      throw new FallaError(1, 'coordination.yaml 已被并发修改，拒绝覆盖');
    }
    await rename(temporary, file);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
  return hash(content);
}
