import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { FallaError } from '../errors.js';

export const KNOWLEDGE_ROOT = '.falla/ui-knowledge';
export const MAX_ENTRY_BYTES = 256 * 1024;
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
export const MAX_ENTRIES = 500;

export function knowledgeError(kind) {
  return new FallaError(1, `UI 知识检查失败：${kind}`, { kind });
}

export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 512
    || /[\\\x00-\x1f\x7f:]/u.test(value) || path.posix.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw knowledgeError('unsafe-path');
  }
  return value;
}

export async function knowledgeProjectRoot(input) {
  const root = path.resolve(input);
  const entry = await lstat(root);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw knowledgeError('unsafe-project-root');
  return realpath(root);
}

export async function inspectPath(root, relative) {
  const parts = safeRelative(relative).split('/');
  let current = root;
  let entry;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      entry = await lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
      throw knowledgeError('unreadable-path');
    }
    if (entry.isSymbolicLink() || (index < parts.length - 1 && !entry.isDirectory())) {
      throw knowledgeError('unsafe-path');
    }
  }
  const resolved = await realpath(current);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw knowledgeError('unsafe-path');
  return { path: resolved, stat: entry };
}

export async function readBoundedFile(root, relative, limit) {
  const target = await inspectPath(root, relative);
  if (!target) throw knowledgeError('missing-evidence');
  if (!target.stat.isFile()) throw knowledgeError('unsafe-path');
  if (target.stat.size > limit) throw knowledgeError('file-too-large');
  const handle = await open(target.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== target.stat.ino || stat.dev !== target.stat.dev) {
      throw knowledgeError('file-changed-during-read');
    }
    // Bound the read itself as well as stat: another writer may grow the file.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > limit) throw knowledgeError('file-too-large');
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      throw knowledgeError('file-changed-during-read');
    }
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

export function evidencePath(value) {
  const relative = safeRelative(value);
  const parts = relative.toLowerCase().split('/');
  const name = parts.at(-1);
  if (parts.some(part => ['.git', '.codegraph', '.index', 'build', '.gradle', 'node_modules'].includes(part))
    || name === '.env' || name.startsWith('.env.') || name === 'local.properties'
    || name === 'google-services.json' || /(?:secret|credential|keystore|signing)/u.test(name)
    || /\.(?:jks|keystore|p12|pfx|pem|key)$/u.test(name)) {
    throw knowledgeError('sensitive-evidence-path');
  }
  if (!/\.(?:kt|java|xml|gradle|kts|toml|properties|json|yaml|yml|md|txt|png|webp|jpg|jpeg|svg)$/iu.test(name)) {
    throw knowledgeError('unsupported-evidence-file');
  }
  return relative;
}

export async function listKnowledgeEntries(root) {
  const entries = [];
  const errors = [];
  for (const [folder, kind] of [['components', 'component'], ['screen-patterns', 'screen-pattern']]) {
    const relative = `${KNOWLEDGE_ROOT}/${folder}`;
    try {
      const target = await inspectPath(root, relative);
      if (!target) continue;
      if (!target.stat.isDirectory()) throw knowledgeError('unsafe-path');
      let visited = 0;
      for await (const item of await opendir(target.path)) {
        visited += 1;
        if (visited > MAX_ENTRIES || entries.length >= MAX_ENTRIES) throw knowledgeError('entry-budget-exceeded');
        if (!item.name.endsWith('.md')) continue;
        if (!item.isFile() || item.isSymbolicLink()) throw knowledgeError('unsafe-entry');
        entries.push({ file: safeRelative(`${relative}/${item.name}`), kind });
      }
    } catch (error) {
      errors.push({ kind: error?.details?.kind ?? 'unreadable-directory', entry: relative });
    }
  }
  return { entries: entries.sort((a, b) => a.file.localeCompare(b.file)), errors };
}
