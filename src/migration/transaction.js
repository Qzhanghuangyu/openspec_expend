import { randomBytes } from 'node:crypto';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';
import { defaultFilesystem } from '../filesystem.js';
import { assertRelativePath, sha256, targetPath } from '../install/files.js';
import { withProjectLock } from '../locks.js';

const JOURNAL_FILE = 'journal.json';
const MAX_JOURNAL_BYTES = 1024 * 1024;
const MIGRATION_ID = /^\d{4}-\d{2}-\d{2}T[0-9TZ.-]+-[a-f0-9]{8}$/;

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isCanonicalRelativePath(relativePath) {
  if (typeof relativePath !== 'string') return false;
  try {
    return assertRelativePath(relativePath) === relativePath;
  } catch {
    return false;
  }
}

function isTarget(relativePath) {
  return isCanonicalRelativePath(relativePath)
    && (relativePath === '.falla/coordination.yaml'
      || relativePath.startsWith('.falla/skill-spec/')
      || relativePath.startsWith('openspec/'));
}

function assertTarget(relativePath) {
  if (isTarget(relativePath)) return;
  throw new FallaError(1, `迁移目标不在允许范围：${relativePath}`);
}

function assertSource(relativePath) {
  if (isCanonicalRelativePath(relativePath)
    && (relativePath.startsWith('mercuryspec/') || relativePath.startsWith('.falla/spec/'))) return;
  throw new FallaError(1, `迁移源不在允许范围：${relativePath}`);
}

function migrationId() {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  return `${timestamp}-${randomBytes(4).toString('hex')}`;
}

async function resolveSource(root, relativePath) {
  assertSource(relativePath);
  const source = targetPath(root, relativePath);
  const entry = await lstat(source);
  if (!entry.isSymbolicLink()) {
    if (!entry.isFile()) throw new FallaError(1, `迁移源必须是普通文件：${relativePath}`);
    return source;
  }
  const resolved = await realpath(source);
  if (!isInside(root, resolved) || !(await stat(resolved)).isFile()) {
    throw new FallaError(1, `迁移源符号链接越过项目边界：${relativePath}`);
  }
  return resolved;
}

async function collectExecution(root, plan, fs) {
  const execution = [];
  for (const operation of plan.operations) {
    if (operation.kind === 'conflict') {
      throw new FallaError(1, '迁移计划仍有冲突，禁止写入');
    }
    if (operation.kind !== 'copy' && operation.kind !== 'write') continue;
    assertTarget(operation.to);
    if (!/^[a-f0-9]{64}$/.test(operation.sha256)) {
      throw new FallaError(1, `迁移操作缺少有效哈希：${operation.to}`);
    }

    let source = null;
    if (operation.kind === 'copy') {
      source = await resolveSource(root, operation.from);
      if (await fs.hashAbsolute(source) !== operation.sha256) {
        throw new FallaError(1, `迁移源在计划后发生变化：${operation.from}`);
      }
    } else if (typeof operation.content !== 'string' && !Buffer.isBuffer(operation.content)) {
      throw new FallaError(1, `迁移写入内容无效：${operation.to}`);
    } else if (sha256(operation.content) !== operation.sha256) {
      throw new FallaError(1, `迁移写入哈希不一致：${operation.to}`);
    }

    const current = await fs.read(root, operation.to);
    const currentHash = current === null ? null : sha256(current);
    if (operation.expectedTargetHash) {
      if (currentHash !== operation.expectedTargetHash) {
        throw new FallaError(1, `迁移目标在计划后发生变化：${operation.to}`);
      }
    } else if (currentHash === operation.sha256) {
      continue;
    } else if (currentHash !== null) {
      throw new FallaError(1, `迁移目标在计划后发生变化：${operation.to}`);
    }
    execution.push({ ...operation, source, beforeHash: currentHash });
  }
  return execution;
}

async function copyExistingTree(sourceRoot, sourceRelative, candidateRoot, fs) {
  const source = targetPath(sourceRoot, sourceRelative);
  let sourceEntry;
  try {
    sourceEntry = await lstat(source);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
    throw error;
  }
  if (sourceEntry.isSymbolicLink() || !sourceEntry.isDirectory()) {
    throw new FallaError(1, `候选复制源必须是真实目录：${sourceRelative}`);
  }

  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const relative = `${sourceRelative}/${entry.name}`;
    const absolute = targetPath(sourceRoot, relative);
    if (entry.isSymbolicLink()) throw new FallaError(1, `候选源包含符号链接：${relative}`);
    if (entry.isDirectory()) {
      await copyExistingTree(sourceRoot, relative, candidateRoot, fs);
    } else if (entry.isFile()) {
      await fs.copyAtomic(absolute, candidateRoot, relative);
    } else {
      throw new FallaError(1, `候选源包含异常文件：${relative}`);
    }
  }
}

async function materializeCandidate(root, candidateRoot, execution, fs) {
  await fs.makeDirectory(candidateRoot, 'openspec');
  await copyExistingTree(root, 'openspec', candidateRoot, fs);
  const coordination = await fs.read(root, '.falla/coordination.yaml');
  if (coordination !== null) {
    await fs.writeAtomic(candidateRoot, '.falla/coordination.yaml', coordination);
  }
  for (const operation of execution) {
    if (operation.kind === 'copy') {
      await fs.copyAtomic(operation.source, candidateRoot, operation.to);
    } else {
      await fs.writeAtomic(candidateRoot, operation.to, operation.content);
    }
  }
}

function journalContent(journal) {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

async function writeJournal(transactionRoot, journal, fs) {
  await fs.writeAtomic(transactionRoot, JOURNAL_FILE, journalContent(journal));
}

async function prepareBackups(root, transactionRoot, execution, id, fs) {
  const backups = [];
  const created = [];
  const directories = new Set();
  for (const operation of execution) {
    for (const directory of await fs.missingParentDirectories(root, operation.to)) {
      directories.add(directory);
    }
    if (operation.beforeHash === null) {
      created.push({ path: operation.to, sha256: operation.sha256 });
      continue;
    }
    const target = targetPath(root, operation.to);
    const backup = `backup/${operation.to}`;
    await fs.copyAtomic(target, transactionRoot, backup);
    if (await fs.hashAbsolute(targetPath(transactionRoot, backup)) !== operation.beforeHash) {
      throw new FallaError(1, `备份校验失败：${operation.to}`);
    }
    backups.push({ path: operation.to, backup, sha256: operation.beforeHash });
  }
  return {
    version: 1,
    id,
    phase: 'prepared',
    appliedCount: 0,
    created,
    createdDirectories: [...directories].sort((left, right) => left.localeCompare(right)),
    backups,
    operations: execution.map(({ kind, to, sha256: digest }) => ({ kind, to, sha256: digest })),
  };
}

async function verifyBeforeWrite(root, operation, fs) {
  const current = await fs.read(root, operation.to);
  const digest = current === null ? null : sha256(current);
  if (digest !== operation.beforeHash) {
    throw new FallaError(1, `迁移目标在写入前发生变化：${operation.to}`);
  }
  if (operation.kind === 'copy' && await fs.hashAbsolute(operation.source) !== operation.sha256) {
    throw new FallaError(1, `迁移源在写入前发生变化：${operation.from}`);
  }
}

async function executeTargets(root, transactionRoot, execution, journal, fs) {
  for (const operation of execution) {
    await verifyBeforeWrite(root, operation, fs);
    if (operation.kind === 'copy') {
      await fs.copyAtomic(operation.source, root, operation.to);
    } else {
      await fs.writeAtomic(root, operation.to, operation.content);
    }
    const written = await fs.read(root, operation.to);
    if (written === null || sha256(written) !== operation.sha256) {
      throw new FallaError(1, `迁移写入校验失败：${operation.to}`);
    }
    journal.appliedCount += 1;
    journal.phase = 'writing';
    await writeJournal(transactionRoot, journal, fs);
  }
  journal.phase = 'applied';
  await writeJournal(transactionRoot, journal, fs);
}

async function restoreJournal(root, transactionRoot, journal, fs) {
  const failures = [];
  for (const backup of [...journal.backups].reverse()) {
    try {
      const source = targetPath(transactionRoot, backup.backup);
      if (await fs.hashAbsolute(source) !== backup.sha256) throw new Error('backup hash mismatch');
      await fs.copyAtomic(source, root, backup.path);
    } catch {
      failures.push(backup.path);
    }
  }
  for (const created of [...journal.created].reverse()) {
    try {
      await fs.removeFile(root, created.path, created.sha256);
    } catch {
      failures.push(created.path);
    }
  }
  for (const directory of [...journal.createdDirectories].sort(
    (left, right) => right.split('/').length - left.split('/').length
  )) {
    try {
      await fs.removeEmptyDirectory(root, directory);
    } catch {
      failures.push(directory);
    }
  }
  if (failures.length > 0) {
    throw new FallaError(5, `回滚不完整，需要人工处理 ${failures.length} 个路径`);
  }
}

async function cleanupTransaction(root, transactionRelative, fs) {
  await fs.removeOwnedTree(root, transactionRelative);
  await fs.removeEmptyDirectory(root, '.falla/migration');
}

function safeFailure(error, message) {
  if (error instanceof FallaError) return error;
  return new FallaError(1, message);
}

export async function applyMigration(rootInput, plan, options = {}) {
  const root = await realpath(path.resolve(rootInput));
  if (await realpath(path.resolve(plan.root)) !== root) {
    throw new FallaError(1, '迁移计划与项目根不一致');
  }
  if (typeof options.validateCandidate !== 'function') {
    throw new FallaError(1, '缺少候选项目校验器');
  }
  const fs = options.fs ?? defaultFilesystem;

  return withProjectLock(root, 'migration', async () => {
    await recoverInterruptedUnlocked(root, fs);
    const execution = await collectExecution(root, plan, fs);
    const id = migrationId();
    const transactionRelative = `.falla/migration/${id}`;
    const transactionRoot = targetPath(root, transactionRelative);
    const candidateRoot = path.join(transactionRoot, 'candidate');
    await fs.makeDirectory(root, transactionRelative);

    try {
      await fs.makeDirectory(transactionRoot, 'candidate');
      await materializeCandidate(root, candidateRoot, execution, fs);
      try {
        await options.validateCandidate(candidateRoot);
      } catch {
        throw new FallaError(1, '候选校验失败，未写入目标项目');
      }
      await fs.removeOwnedTree(transactionRoot, 'candidate');
    } catch (error) {
      await cleanupTransaction(root, transactionRelative, fs);
      throw safeFailure(error, '候选准备失败，未写入目标项目');
    }

    let journal;
    try {
      journal = await prepareBackups(root, transactionRoot, execution, id, fs);
      await writeJournal(transactionRoot, journal, fs);
    } catch (error) {
      await cleanupTransaction(root, transactionRelative, fs);
      throw safeFailure(error, '迁移备份失败，未写入目标项目');
    }

    try {
      await executeTargets(root, transactionRoot, execution, journal, fs);
      if (options.validateTarget) await options.validateTarget(root);
      await fs.writeAtomic(transactionRoot, 'report.json', `${JSON.stringify({
        id,
        applied: execution.length,
        created: journal.created.length,
        backups: journal.backups.length,
      }, null, 2)}\n`);
      return {
        id,
        applied: execution.length,
        created: journal.created.length,
        backups: journal.backups.length,
      };
    } catch {
      try {
        await preflightInterruptedRollback(root, transactionRoot, journal, fs);
        await restoreJournal(root, transactionRoot, journal, fs);
        await cleanupTransaction(root, transactionRelative, fs);
      } catch (rollbackError) {
        journal.phase = 'rollback-incomplete';
        try {
          await writeJournal(transactionRoot, journal, fs);
        } catch {
          // The original transaction directory remains for manual inspection.
        }
        if (rollbackError instanceof FallaError && rollbackError.code === 5) throw rollbackError;
        throw new FallaError(5, '回滚不完整，需要人工处理');
      }
      throw new FallaError(4, '迁移写入失败，已回滚');
    }
  });
}

function assertJournal(value, id, phases) {
  if (!value || typeof value !== 'object' || value.version !== 1 || value.id !== id
    || !phases.includes(value.phase) || !Array.isArray(value.created)
    || !Array.isArray(value.createdDirectories) || !Array.isArray(value.backups)
    || !Array.isArray(value.operations) || !Number.isInteger(value.appliedCount)
    || value.appliedCount < 0 || value.appliedCount > value.operations.length) {
    throw new FallaError(1, '迁移 journal 无效或当前状态不可回滚');
  }

  const digestPattern = /^[a-f0-9]{64}$/;
  const operations = new Map();
  const covered = new Set();
  try {
    for (const operation of value.operations) {
      if (!operation || typeof operation !== 'object'
        || (operation.kind !== 'copy' && operation.kind !== 'write')
        || !isTarget(operation.to) || !digestPattern.test(operation.sha256)
        || operations.has(operation.to)) throw new Error('invalid operation');
      operations.set(operation.to, operation);
    }
    for (const created of value.created) {
      const operation = operations.get(created?.path);
      if (!operation || created.sha256 !== operation.sha256 || covered.has(created.path)) {
        throw new Error('invalid created entry');
      }
      covered.add(created.path);
    }
    for (const backup of value.backups) {
      if (!operations.has(backup?.path) || backup.backup !== `backup/${backup.path}`
        || !digestPattern.test(backup.sha256) || covered.has(backup.path)) {
        throw new Error('invalid backup entry');
      }
      covered.add(backup.path);
    }
    if (covered.size !== operations.size) throw new Error('incomplete operation coverage');
    for (const directory of value.createdDirectories) {
      if (!isCanonicalRelativePath(directory)
        || !(directory === '.falla' || directory === '.falla/skill-spec'
          || directory.startsWith('.falla/skill-spec/')
          || directory === 'openspec' || directory.startsWith('openspec/'))) {
        throw new Error('invalid created directory');
      }
    }
    if (value.phase === 'prepared' && value.appliedCount !== 0) {
      throw new Error('invalid prepared count');
    }
    if (value.phase === 'applied' && value.appliedCount !== value.operations.length) {
      throw new Error('invalid applied count');
    }
  } catch {
    throw new FallaError(1, '迁移 journal 无效或当前状态不可回滚');
  }
  return value;
}

async function loadJournal(transactionRoot, id, fs, phases = ['applied']) {
  const content = await fs.read(transactionRoot, JOURNAL_FILE);
  if (content === null || content.byteLength > MAX_JOURNAL_BYTES) {
    throw new FallaError(1, '迁移 journal 不存在或过大');
  }
  try {
    return assertJournal(JSON.parse(content.toString('utf8')), id, phases);
  } catch (error) {
    if (error instanceof FallaError) throw error;
    throw new FallaError(1, '迁移 journal 不是有效 JSON');
  }
}

async function preflightInterruptedRollback(root, transactionRoot, journal, fs) {
  const operations = new Map(journal.operations.map((operation) => [operation.to, operation]));
  for (const backup of journal.backups) {
    const backupFile = targetPath(transactionRoot, backup.backup);
    if (await fs.hashAbsolute(backupFile) !== backup.sha256) {
      throw new FallaError(5, `迁移备份已损坏：${backup.path}`);
    }
    const current = await fs.read(root, backup.path);
    const currentHash = current === null ? null : sha256(current);
    const desiredHash = operations.get(backup.path)?.sha256;
    if (currentHash !== backup.sha256 && currentHash !== desiredHash) {
      throw new FallaError(5, `中断后目标又被修改：${backup.path}`);
    }
  }
  for (const created of journal.created) {
    const current = await fs.read(root, created.path);
    if (current !== null && sha256(current) !== created.sha256) {
      throw new FallaError(5, `中断后目标又被修改：${created.path}`);
    }
  }
}

async function recoverInterruptedUnlocked(root, fs) {
  const migrationDirectory = path.join(root, '.falla', 'migration');
  let entries;
  try {
    entries = await readdir(migrationDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
  const recovered = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!MIGRATION_ID.test(entry.name)) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new FallaError(5, `迁移记录目录无效：${entry.name}`);
    }
    const transactionRelative = `.falla/migration/${entry.name}`;
    const transactionRoot = targetPath(root, transactionRelative);
    const journal = await loadJournal(transactionRoot, entry.name, fs, [
      'applied', 'prepared', 'writing', 'rollback-incomplete',
    ]);
    if (journal.phase === 'applied') continue;
    await preflightInterruptedRollback(root, transactionRoot, journal, fs);
    try {
      await restoreJournal(root, transactionRoot, journal, fs);
      await cleanupTransaction(root, transactionRelative, fs);
      recovered.push(entry.name);
    } catch (error) {
      if (error instanceof FallaError && error.code === 5) throw error;
      throw new FallaError(5, '中断迁移恢复不完整，需要人工处理');
    }
  }
  return recovered;
}

export async function recoverInterruptedMigrations(rootInput, options = {}) {
  const root = await realpath(path.resolve(rootInput));
  const fs = options.fs ?? defaultFilesystem;
  return withProjectLock(root, 'migration', () => recoverInterruptedUnlocked(root, fs));
}

async function preflightRollback(root, transactionRoot, journal, fs) {
  for (const operation of journal.operations) {
    const current = await fs.read(root, operation.to);
    if (current === null || sha256(current) !== operation.sha256) {
      throw new FallaError(1, `迁移后已修改，拒绝回滚覆盖：${operation.to}`);
    }
  }
  for (const backup of journal.backups) {
    const file = targetPath(transactionRoot, backup.backup);
    if (await fs.hashAbsolute(file) !== backup.sha256) {
      throw new FallaError(1, `迁移备份已损坏：${backup.path}`);
    }
  }
}

export async function rollbackMigration(rootInput, id, options = {}) {
  if (!MIGRATION_ID.test(id)) throw new FallaError(1, '迁移 ID 无效');
  const root = await realpath(path.resolve(rootInput));
  const fs = options.fs ?? defaultFilesystem;
  return withProjectLock(root, 'migration', async () => {
    const transactionRelative = `.falla/migration/${id}`;
    const transactionRoot = targetPath(root, transactionRelative);
    const entry = await lstat(transactionRoot).catch((error) => {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new FallaError(1, `找不到迁移记录：${id}`);
      }
      throw error;
    });
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new FallaError(1, '迁移记录目录无效');
    }
    const journal = await loadJournal(transactionRoot, id, fs);
    await preflightRollback(root, transactionRoot, journal, fs);
    try {
      await restoreJournal(root, transactionRoot, journal, fs);
      await cleanupTransaction(root, transactionRelative, fs);
    } catch (error) {
      if (error instanceof FallaError && error.code === 5) throw error;
      throw new FallaError(5, '回滚不完整，需要人工处理');
    }
    return { id, rolledBack: true };
  });
}
