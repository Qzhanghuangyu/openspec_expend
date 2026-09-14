#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { codeGraphContext, prepareCodeGraph } from './falla-codegraph.mjs';

const MAX_INPUT_BYTES = 1024 * 1024;
const CODEGRAPH_MARKER = '@codegraph-prepared';
const SKILL_SPECS = {
  'falla-preflight': ['[Must Read]soul.md', '[分析必读]preflight.md'],
  'falla-propose': ['[Must Read]soul.md', '[架构必读]propose.md'],
  'falla-apply-change': ['[Must Read]soul.md', '[模块选读]apply.md'],
  'falla-archive-change': ['[Must Read]soul.md', '[任务选读]archive.md'],
};

function fail(message) {
  process.stderr.write(`[FallaOpenSpec] ${message}\n`);
  process.exitCode = 2;
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_INPUT_BYTES) {
        reject(new Error('Hook 输入超过 1 MiB 限制'));
        process.stdin.destroy();
        return;
      }
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function extractSkillName(payload) {
  const input = payload?.tool_input ?? payload?.toolInput ?? {};
  return String(input.name ?? input.skill ?? input.skillName ?? input.command ?? '').trim();
}

async function isRealDirectory(candidate) {
  try {
    const entry = await lstat(candidate);
    return !entry.isSymbolicLink() && entry.isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function findProjectRoot(start) {
  let current = await realpath(path.resolve(start));
  const filesystemRoot = path.parse(current).root;
  while (current !== filesystemRoot) {
    if (await isRealDirectory(path.join(current, 'openspec'))
      && await isRealDirectory(path.join(current, '.falla'))
      && await isRealDirectory(path.join(current, '.falla', 'skill-spec'))) {
      return current;
    }
    current = path.dirname(current);
  }
  if (await isRealDirectory(path.join(filesystemRoot, 'openspec'))
    && await isRealDirectory(path.join(filesystemRoot, '.falla'))
    && await isRealDirectory(path.join(filesystemRoot, '.falla', 'skill-spec'))) {
    return filesystemRoot;
  }
  throw new Error('找不到安装了 FallaOpenSpec 的项目根');
}

async function readRule(root, relative) {
  const rule = path.join(root, '.falla', 'skill-spec', relative);
  const entry = await lstat(rule);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`规则文件必须是普通文件：${relative}`);
  }
  const base = await realpath(path.join(root, '.falla', 'skill-spec'));
  const resolved = await realpath(rule);
  if (!resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`规则文件越过项目边界：${relative}`);
  }
  return readFile(resolved, 'utf8');
}

function markerPath(root, sessionId) {
  if (!sessionId) return null;
  const safeSession = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const projectId = createHash('sha256').update(root).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), 'falla-openspec-hook', projectId, `${safeSession}.json`);
}

async function readInjected(file) {
  if (!file) return new Set();
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    return new Set(Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);
  } catch {
    return new Set();
  }
}

async function writeInjected(file, values) {
  if (!file) return;
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify([...values].sort())}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, file);
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('Hook 输入不是有效 JSON');
  }

  const skillName = extractSkillName(payload);
  const required = SKILL_SPECS[skillName];
  if (!required) return;

  const start = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const root = await findProjectRoot(start);
  const marker = markerPath(root, payload.session_id ?? payload.sessionId);
  const injected = await readInjected(marker);
  const pending = required.filter((relative) => !injected.has(relative));
  let graphContext = null;
  if (!injected.has(CODEGRAPH_MARKER)) {
    graphContext = codeGraphContext(await prepareCodeGraph(root));
    injected.add(CODEGRAPH_MARKER);
  }
  if (pending.length === 0 && graphContext === null) return;

  const loaded = [];
  const missing = [];
  for (const relative of pending) {
    try {
      loaded.push({ relative, content: await readRule(root, relative) });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        missing.push(relative);
      } else {
        throw error;
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`缺少强制规则文件：${missing.join('、')}`);
  }

  const sections = loaded.map(({ relative, content }) => `===== ${relative} =====\n${content.trim()}`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: [
        `【FallaOpenSpec 规则：执行 ${skillName} 前必须遵守】`,
        ...(graphContext ? [graphContext] : []),
        ...sections,
      ].join('\n\n'),
    },
  }));

  for (const { relative } of loaded) injected.add(relative);
  await writeInjected(marker, injected);
}

main().catch((error) => fail(error.message || 'Hook 执行失败'));
