import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from './errors.js';
import {
  assertRelativePath,
  readProjectFile,
  targetPath,
  writeAtomicFile,
} from './install/files.js';

async function safeLstat(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function hashAbsolute(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function assertSafeParents(root, relativePath) {
  const safe = assertRelativePath(relativePath);
  let current = root;
  for (const segment of safe.split('/').slice(0, -1)) {
    current = path.join(current, segment);
    const entry = await safeLstat(current);
    if (!entry) return;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new FallaError(1, `路径包含非真实目录：${safe}`);
    }
  }
}

async function copyAtomic(source, root, relativePath) {
  const safe = assertRelativePath(relativePath);
  const sourceEntry = await lstat(source);
  if (sourceEntry.isSymbolicLink() || !sourceEntry.isFile()) {
    throw new FallaError(1, `复制源必须是普通文件：${safe}`);
  }
  await assertSafeParents(root, safe);
  const target = targetPath(root, safe);
  await mkdir(path.dirname(target), { recursive: true });
  await assertSafeParents(root, safe);
  const targetEntry = await safeLstat(target);
  if (targetEntry?.isSymbolicLink() || (targetEntry && !targetEntry.isFile())) {
    throw new FallaError(1, `复制目标必须是普通文件：${safe}`);
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary, 1);
    await rename(temporary, target);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

async function missingParentDirectories(root, relativePath) {
  const safe = assertRelativePath(relativePath);
  const result = [];
  let current = root;
  let relative = '';
  for (const segment of safe.split('/').slice(0, -1)) {
    relative = relative ? `${relative}/${segment}` : segment;
    current = path.join(current, segment);
    const entry = await safeLstat(current);
    if (!entry) {
      result.push(relative);
    } else if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new FallaError(1, `路径包含非真实目录：${safe}`);
    }
  }
  return result;
}

async function makeDirectory(root, relativePath) {
  const safe = assertRelativePath(relativePath);
  await assertSafeParents(root, `${safe}/placeholder`);
  const target = targetPath(root, safe);
  const entry = await safeLstat(target);
  if (entry) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new FallaError(1, `目录目标无效：${safe}`);
    }
    return false;
  }
  await mkdir(target, { recursive: true });
  return true;
}

async function removeFile(root, relativePath, expectedHash = undefined) {
  const safe = assertRelativePath(relativePath);
  await assertSafeParents(root, safe);
  const target = targetPath(root, safe);
  const entry = await safeLstat(target);
  if (!entry) return false;
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new FallaError(1, `删除目标必须是普通文件：${safe}`);
  }
  if (expectedHash && await hashAbsolute(target) !== expectedHash) {
    throw new FallaError(1, `文件内容已变化，拒绝删除：${safe}`);
  }
  await unlink(target);
  return true;
}

async function removeEmptyDirectory(root, relativePath) {
  const safe = assertRelativePath(relativePath);
  const target = targetPath(root, safe);
  const entry = await safeLstat(target);
  if (!entry) return false;
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new FallaError(1, `清理目标必须是目录：${safe}`);
  }
  try {
    await rmdir(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOTEMPTY' || error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function removeOwnedTree(root, relativePath) {
  const safe = assertRelativePath(relativePath);
  const target = targetPath(root, safe);
  const entry = await safeLstat(target);
  if (!entry) return;
  if (entry.isSymbolicLink()) throw new FallaError(5, `事务目录不能是符号链接：${safe}`);
  if (entry.isFile()) {
    await unlink(target);
    return;
  }
  if (!entry.isDirectory()) throw new FallaError(5, `事务目录类型无效：${safe}`);
  for (const child of await readdir(target, { withFileTypes: true })) {
    await removeOwnedTree(root, `${safe}/${child.name}`);
  }
  await rmdir(target);
}

export const defaultFilesystem = {
  copyAtomic,
  hashAbsolute,
  makeDirectory,
  missingParentDirectories,
  read: readProjectFile,
  removeEmptyDirectory,
  removeFile,
  removeOwnedTree,
  writeAtomic: writeAtomicFile,
};
