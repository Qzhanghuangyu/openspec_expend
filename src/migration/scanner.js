import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  open,
  readdir,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';

const RULE_PREFIX = /^\[(?:Must Read|分析必读|架构必读|模块选读|任务选读)\]/;
const SKIPPED_SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const ALLOWED_BINARY_EXTENSIONS = new Set([
  '.gif', '.jpeg', '.jpg', '.pdf', '.png', '.webp',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isSensitive(relativePath) {
  const name = path.basename(relativePath).toLowerCase();
  return name === '.env'
    || name.startsWith('.env.')
    || /(?:^|[-_.])(api[-_.]?key|password|private[-_.]?key|secret|token)(?:[-_.]|$)/i.test(name)
    || /^(?:id_rsa|id_ed25519)(?:\.|$)/.test(name)
    || /\.(?:jks|keystore|p12|pfx|pem)$/.test(name);
}

function classify(relativePath) {
  if (relativePath.startsWith('.falla/skill-spec/')) return 'current-rule';
  if (relativePath.startsWith('.falla/spec/')) return 'legacy-rule';
  if (relativePath === 'mercuryspec/config.yaml') return 'legacy-config';
  if (relativePath.startsWith('mercuryspec/schemas/')) return 'legacy-schema';
  if (relativePath.startsWith('mercuryspec/specs/')) {
    const name = relativePath.slice('mercuryspec/specs/'.length).split('/')[0];
    return RULE_PREFIX.test(name) ? 'legacy-workflow-rule' : 'business-spec';
  }
  if (relativePath.startsWith('mercuryspec/changes/archive/')) {
    const rest = relativePath.slice('mercuryspec/changes/archive/'.length).split('/');
    return rest[1] === 'changes' && rest.length >= 4
      ? 'archived-child-change'
      : 'archived-parent-change';
  }
  if (relativePath.startsWith('mercuryspec/changes/')) {
    const rest = relativePath.slice('mercuryspec/changes/'.length).split('/');
    return rest[1] === 'changes' && rest.length >= 4
      ? 'active-child-change'
      : 'active-parent-change';
  }
  return 'legacy-other';
}

async function digestFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function hasNullByte(file, size) {
  if (size === 0) return false;
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, 8192));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

async function safeEntry(root, absolute, relative) {
  const entry = await lstat(absolute);
  if (!entry.isSymbolicLink()) return { entry, source: absolute, symlink: false };

  const resolved = await realpath(absolute);
  if (!isInside(root, resolved)) {
    throw new FallaError(1, `项目外符号链接：${relative}`);
  }
  const resolvedEntry = await stat(resolved);
  if (resolvedEntry.isDirectory()) {
    throw new FallaError(1, `不支持符号链接目录：${relative}`);
  }
  if (!resolvedEntry.isFile()) {
    throw new FallaError(1, `不支持的符号链接目标：${relative}`);
  }
  return { entry: resolvedEntry, source: resolved, symlink: true };
}

async function scanDirectory(root, relativeDirectory, files, skipped, warnings) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  for (const directoryEntry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = toPosix(path.join(relativeDirectory, directoryEntry.name));
    if (SKIPPED_SYSTEM_FILES.has(directoryEntry.name)) {
      skipped.push({ path: relative, reason: 'system-file' });
      continue;
    }

    const checked = await safeEntry(root, path.join(root, relative), relative);
    if (checked.entry.isDirectory()) {
      await scanDirectory(root, relative, files, skipped, warnings);
      continue;
    }
    if (!checked.entry.isFile()) {
      throw new FallaError(1, `不支持的文件类型：${relative}`);
    }
    if (isSensitive(relative)) {
      throw new FallaError(1, `发现敏感文件，停止迁移：${relative}`);
    }
    const binary = await hasNullByte(checked.source, checked.entry.size);
    if (binary && !ALLOWED_BINARY_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      throw new FallaError(1, `发现异常二进制文件，停止迁移：${relative}`);
    }
    if (checked.symlink) warnings.push({ path: relative, kind: 'internal-symlink-copied-as-file' });
    files.push({
      path: relative,
      kind: classify(relative),
      size: checked.entry.size,
      sha256: await digestFile(checked.source),
      binary,
      symlink: checked.symlink,
    });
  }
}

async function optionalDirectory(root, relative) {
  try {
    const entry = await lstat(path.join(root, relative));
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new FallaError(1, `迁移源必须是真实目录：${relative}`);
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function scanLegacyProject(rootInput) {
  const requestedRoot = path.resolve(rootInput);
  const rootEntry = await lstat(requestedRoot).catch((error) => {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new FallaError(1, `项目目录不存在：${requestedRoot}`);
    }
    throw error;
  });
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new FallaError(1, '项目根必须是真实目录，不能是符号链接');
  }
  const root = await realpath(requestedRoot);
  if (!await optionalDirectory(root, 'mercuryspec')) {
    throw new FallaError(1, '找不到旧 mercuryspec 目录');
  }

  const files = [];
  const skipped = [];
  const warnings = [];
  for (const relative of ['mercuryspec', '.falla/skill-spec', '.falla/spec']) {
    if (await optionalDirectory(root, relative)) {
      await scanDirectory(root, relative, files, skipped, warnings);
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  skipped.sort((left, right) => left.path.localeCompare(right.path));
  return { root, files, skipped, warnings };
}
