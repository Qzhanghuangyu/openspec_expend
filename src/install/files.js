import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FallaError } from '../errors.js';

const TEMPLATE_ROOT = fileURLToPath(new URL('../../templates/', import.meta.url));
const DOCUMENT_ROOT = fileURLToPath(new URL('../../docs/', import.meta.url));
const TOOL_DIRECTORIES = {
  claude: '.claude',
  codex: '.codex',
};

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function assertRelativePath(value) {
  const candidate = String(value).replaceAll(path.sep, '/');
  const normalized = path.posix.normalize(candidate);
  if (!candidate || candidate.includes('\0') || path.posix.isAbsolute(candidate)
    || normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    throw new FallaError(1, `安装路径越过项目边界：${candidate}`);
  }
  return normalized;
}

export function targetPath(root, relativePath) {
  const safe = assertRelativePath(relativePath);
  const target = path.join(root, ...safe.split('/'));
  const relation = path.relative(root, target);
  if (relation.startsWith(`..${path.sep}`) || relation === '..' || path.isAbsolute(relation)) {
    throw new FallaError(1, `安装路径越过项目边界：${safe}`);
  }
  return target;
}

async function safeLstat(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function assertSafeAncestors(root, relativePath) {
  const safe = assertRelativePath(relativePath);
  const segments = safe.split('/').slice(0, -1);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const entry = await safeLstat(current);
    if (!entry) return;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new FallaError(1, `安装路径包含非真实目录：${safe}`);
    }
  }
}

export async function readProjectFile(root, relativePath) {
  const safe = assertRelativePath(relativePath);
  await assertSafeAncestors(root, safe);
  const target = targetPath(root, safe);
  const entry = await safeLstat(target);
  if (!entry) return null;
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new FallaError(1, `安装目标必须是普通文件：${safe}`);
  }
  return readFile(target);
}

async function listTemplateFiles(directory, relativeDirectory = '') {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new FallaError(1, `模板不能包含符号链接：${relative}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listTemplateFiles(directory, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new FallaError(1, `模板包含不支持的文件类型：${relative}`);
    }
  }
  return files;
}

async function addTree(result, sourceRelative, targetRelative) {
  const source = path.join(TEMPLATE_ROOT, sourceRelative);
  for (const file of await listTemplateFiles(source)) {
    const relativePath = assertRelativePath(path.posix.join(
      targetRelative,
      file.split(path.sep).join('/')
    ));
    result.push({ relativePath, content: await readFile(path.join(source, file)) });
  }
}

export async function collectManagedFiles(toolIds) {
  const tools = [...new Set(toolIds)];
  for (const tool of tools) {
    if (!TOOL_DIRECTORIES[tool]) {
      throw new FallaError(1, `不支持的 Agent 工具：${tool}`);
    }
  }

  const result = [];
  result.push({
    relativePath: '.falla/installation-and-update.md',
    content: await readFile(path.join(DOCUMENT_ROOT, 'installation-and-update.md')),
  });
  await addTree(result, path.join('openspec', 'schemas'), path.posix.join('openspec', 'schemas'));
  await addTree(result, 'skill-spec', path.posix.join('.falla', 'skill-spec'));
  await addTree(result, 'ui-knowledge', path.posix.join('.falla', 'ui-knowledge'));
  for (const tool of tools) {
    await addTree(
      result,
      'skills',
      path.posix.join(TOOL_DIRECTORIES[tool], 'skills')
    );
  }
  if (tools.includes('claude')) {
    result.push({
      relativePath: '.claude/hooks/falla-spec-guard.mjs',
      content: await readFile(path.join(TEMPLATE_ROOT, 'hooks', 'falla-spec-guard.mjs')),
    });
    result.push({
      relativePath: '.claude/hooks/falla-codegraph.mjs',
      content: await readFile(path.join(TEMPLATE_ROOT, 'hooks', 'falla-codegraph.mjs')),
    });
  }
  if (tools.includes('codex')) {
    result.push({
      relativePath: '.codex/hooks/falla-spec-session.mjs',
      content: await readFile(path.join(TEMPLATE_ROOT, 'hooks', 'falla-spec-session.mjs')),
    });
    result.push({
      relativePath: '.codex/hooks/falla-codegraph.mjs',
      content: await readFile(path.join(TEMPLATE_ROOT, 'hooks', 'falla-codegraph.mjs')),
    });
  }

  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function planManagedFiles(root, files, previousFiles = {}) {
  const seen = new Set();
  const plan = [];
  for (const file of files) {
    const relativePath = assertRelativePath(file.relativePath);
    if (seen.has(relativePath)) throw new FallaError(1, `重复安装目标：${relativePath}`);
    seen.add(relativePath);

    const desiredHash = sha256(file.content);
    const current = await readProjectFile(root, relativePath);
    const previousHash = previousFiles[relativePath];
    if (current === null) {
      if (previousHash) {
        throw new FallaError(1, `用户修改的受管文件不能覆盖：${relativePath}`);
      }
      plan.push({ ...file, relativePath, desiredHash, action: 'write' });
      continue;
    }

    const currentHash = sha256(current);
    if (currentHash === desiredHash) {
      plan.push({ ...file, relativePath, desiredHash, action: 'skip' });
    } else if (previousHash && currentHash === previousHash) {
      plan.push({ ...file, relativePath, desiredHash, action: 'write' });
    } else {
      throw new FallaError(1, `用户修改的受管文件不能覆盖：${relativePath}`);
    }
  }
  return plan;
}

export async function planManagedFileRemovals(root, relativePaths, previousFiles = {}) {
  const plan = [];
  for (const candidate of [...new Set(relativePaths)].sort()) {
    const relativePath = assertRelativePath(candidate);
    const expectedHash = previousFiles[relativePath];
    const current = await readProjectFile(root, relativePath);
    if (current === null) {
      plan.push({ relativePath, expectedHash, action: 'skip' });
      continue;
    }
    if (sha256(current) !== expectedHash) {
      throw new FallaError(1, `用户修改的受管文件不能删除：${relativePath}`);
    }
    plan.push({ relativePath, expectedHash, action: 'delete' });
  }
  return plan;
}

export async function writeAtomicFile(root, relativePath, content) {
  const safe = assertRelativePath(relativePath);
  await assertSafeAncestors(root, safe);
  const target = targetPath(root, safe);
  await mkdir(path.dirname(target), { recursive: true });
  await assertSafeAncestors(root, safe);
  const current = await safeLstat(target);
  if (current?.isSymbolicLink() || (current && !current.isFile())) {
    throw new FallaError(1, `安装目标必须是普通文件：${safe}`);
  }

  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
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

export async function applyManagedFilePlan(root, plan) {
  for (const item of plan) {
    if (item.action === 'write') {
      await writeAtomicFile(root, item.relativePath, item.content);
    }
  }
}

export async function applyManagedFileRemovalPlan(root, plan) {
  for (const item of plan) {
    if (item.action !== 'delete') continue;
    const current = await readProjectFile(root, item.relativePath);
    if (current === null) continue;
    if (sha256(current) !== item.expectedHash) {
      throw new FallaError(1, `用户修改的受管文件不能删除：${item.relativePath}`);
    }
    await unlink(targetPath(root, item.relativePath));
  }
}
