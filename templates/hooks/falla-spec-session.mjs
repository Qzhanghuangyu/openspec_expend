#!/usr/bin/env node

import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_INPUT_BYTES = 1024 * 1024;
const SOUL = '[Must Read]soul.md';
const PHASES = [
  ['falla-preflight', '[分析必读]preflight.md'],
  ['falla-propose', '[架构必读]propose.md'],
  ['falla-apply-change', '[模块选读]apply.md'],
  ['falla-archive-change', '[任务选读]archive.md'],
];

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

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('Hook 输入不是有效 JSON');
  }

  const root = await findProjectRoot(payload.cwd || process.cwd());
  let soul;
  try {
    soul = await readRule(root, SOUL);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new Error(`缺少强制规则文件：${SOUL}`);
    }
    throw error;
  }

  const phaseList = PHASES.map(
    ([skill, document]) => `- ${skill} 前必读：\`.falla/skill-spec/${document}\``
  ).join('\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [
        '【FallaOpenSpec 全局规则：本会话必须遵守】',
        phaseList,
        `===== ${SOUL} =====\n${soul.trim()}`,
      ].join('\n\n'),
    },
  }));
}

main().catch((error) => fail(error.message || 'Hook 执行失败'));
