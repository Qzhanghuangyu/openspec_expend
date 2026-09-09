import { FallaError } from '../errors.js';
import {
  readProjectFile,
  sha256,
  writeAtomicFile,
} from './files.js';

const AGENTS_PATH = 'AGENTS.md';
const AGENTS_START = '<!-- falla-spec-guard:start -->';
const AGENTS_END = '<!-- falla-spec-guard:end -->';
const CODEX_CONFIG_PATH = '.codex/config.toml';
const CODEX_START = '# falla-spec-session:start';
const CODEX_END = '# falla-spec-session:end';
const CLAUDE_SETTINGS_PATH = '.claude/settings.json';

const HOOK_REGISTRATION_PATHS = new Set([
  AGENTS_PATH,
  CODEX_CONFIG_PATH,
  CLAUDE_SETTINGS_PATH,
]);

const AGENTS_BODY = `## FallaOpenSpec Skill 约束（必读）

使用 \`falla-preflight\` / \`falla-propose\` / \`falla-apply-change\` / \`falla-archive-change\` 前，必须先读取：

- 全局入口：\`.falla/skill-spec/[Must Read]soul.md\`
- preflight：\`.falla/skill-spec/[分析必读]preflight.md\`
- propose：\`.falla/skill-spec/[架构必读]propose.md\`
- apply：\`.falla/skill-spec/[模块选读]apply.md\`
- archive：\`.falla/skill-spec/[任务选读]archive.md\`

项目业务规格只从 \`openspec/specs/\` 读取；不得从旧 \`.falla/spec/\` 读取规则。缺少必读文件时停止执行对应 Skill。`;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableHash(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

const CODEX_HOOK_LAUNCHER = [
  "import{lstatSync,readSync}from'node:fs';",
  "import{spawnSync}from'node:child_process';",
  "import path from'node:path';",
  "const isDirectory=(candidate)=>{try{const entry=lstatSync(candidate);return !entry.isSymbolicLink()&&entry.isDirectory()}catch(error){if(error?.code==='ENOENT'||error?.code==='ENOTDIR')return false;throw error}};",
  "const fail=(message)=>{process.stderr.write('[FallaOpenSpec] '+message+'\\n');process.exitCode=2};",
  'try{',
  'const chunks=[];let bytes=0;',
  "for(;;){const buffer=Buffer.allocUnsafe(Math.min(65536,1048577-bytes));const count=readSync(0,buffer,0,buffer.length,null);if(count===0)break;bytes+=count;if(bytes>1048576)throw new Error('INPUT_TOO_LARGE');chunks.push(buffer.subarray(0,count))}",
  "const input=Buffer.concat(chunks).toString('utf8');",
  "let payload;try{payload=input?JSON.parse(input):{}}catch{throw new Error('INVALID_INPUT')}",
  'let current=path.resolve(payload.cwd||process.cwd());',
  "for(;;){if(isDirectory(path.join(current,'openspec'))&&isDirectory(path.join(current,'.falla'))&&isDirectory(path.join(current,'.falla','skill-spec')))break;const parent=path.dirname(current);if(parent===current)throw new Error('ROOT_NOT_FOUND');current=parent}",
  "if(!isDirectory(path.join(current,'.codex'))||!isDirectory(path.join(current,'.codex','hooks')))throw new Error('INVALID_HOOK');",
  "const script=path.join(current,'.codex','hooks','falla-spec-session.mjs');",
  "const entry=lstatSync(script);if(entry.isSymbolicLink()||!entry.isFile())throw new Error('INVALID_HOOK');",
  "const result=spawnSync(process.execPath,[script],{input,encoding:'utf8',maxBuffer:2097152});",
  'if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);',
  'if(result.error)throw result.error;process.exitCode=result.status??2;',
  "}catch(error){const message=error?.message==='INVALID_INPUT'?'Hook 输入不是有效 JSON':error?.message==='INPUT_TOO_LARGE'?'Hook 输入超过 1 MiB 限制':'Hook 启动失败';fail(message)}",
].join('');
const CODEX_HOOK_COMMAND = `node --input-type=module --eval ${JSON.stringify(CODEX_HOOK_LAUNCHER)}`;

function codexHookBody() {
  return `[[hooks.SessionStart]]\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(CODEX_HOOK_COMMAND)}`;
}

function markedSection(start, body, end) {
  return `${start}\n${body.trim()}\n${end}`;
}

function extractMarkedSection(existing, start, end, relativePath) {
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  const duplicate = startIndex !== existing.lastIndexOf(start)
    || endIndex !== existing.lastIndexOf(end);
  if ((startIndex < 0) !== (endIndex < 0)
    || duplicate
    || (startIndex >= 0 && endIndex < startIndex)) {
    throw new FallaError(1, `Falla marker 损坏：${relativePath}`);
  }
  if (startIndex < 0) return null;
  return existing.slice(startIndex, endIndex + end.length);
}

function replaceMarkedSection(existing, desired, start, end, previousHash, relativePath) {
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  const duplicate = startIndex !== existing.lastIndexOf(start) || endIndex !== existing.lastIndexOf(end);
  if ((startIndex < 0) !== (endIndex < 0) || duplicate || (startIndex >= 0 && endIndex < startIndex)) {
    throw new FallaError(1, `Falla marker 损坏，拒绝覆盖：${relativePath}`);
  }

  if (startIndex < 0) {
    if (previousHash) throw new FallaError(1, `用户修改的 marker 不能覆盖：${relativePath}`);
    const separator = existing.trim() ? '\n\n' : '';
    return `${existing.trimEnd()}${separator}${desired}\n`;
  }

  const currentEnd = endIndex + end.length;
  const currentSection = existing.slice(startIndex, currentEnd);
  const currentHash = sha256(currentSection);
  const desiredHash = sha256(desired);
  if (currentHash !== desiredHash && currentHash !== previousHash) {
    throw new FallaError(1, `用户修改的 marker 不能覆盖：${relativePath}`);
  }
  return `${existing.slice(0, startIndex)}${desired}${existing.slice(currentEnd)}`;
}

async function planMarker(root, relativePath, start, body, end, previousHash) {
  const desired = markedSection(start, body, end);
  const existing = (await readProjectFile(root, relativePath))?.toString('utf8') ?? '';
  const content = replaceMarkedSection(existing, desired, start, end, previousHash, relativePath);
  return {
    relativePath,
    content,
    managedHash: sha256(desired),
    action: content === existing ? 'skip' : 'write',
  };
}

async function planMarkerRemoval(root, relativePath, start, end, previousHash) {
  const existing = (await readProjectFile(root, relativePath))?.toString('utf8') ?? '';
  const section = extractMarkedSection(existing, start, end, relativePath);
  if (section === null) return { relativePath, content: existing, action: 'skip' };
  if (sha256(section) !== previousHash) {
    throw new FallaError(1, `用户修改的 marker 不能删除：${relativePath}`);
  }
  return {
    relativePath,
    content: `${existing.slice(0, existing.indexOf(start))}${existing.slice(existing.indexOf(end) + end.length)}`,
    expectedFileHash: sha256(existing),
    action: 'write',
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFallaClaudeHook(entry) {
  return entry?.matcher === 'Skill'
    && Array.isArray(entry.hooks)
    && entry.hooks.some((hook) => typeof hook?.command === 'string'
      && hook.command.includes('falla-spec-guard.mjs'));
}

export function isHookRegistrationPath(relativePath) {
  return HOOK_REGISTRATION_PATHS.has(relativePath);
}

export async function getHookRegistrationHash(root, relativePath) {
  if (!isHookRegistrationPath(relativePath)) {
    throw new FallaError(1, `不是受支持的 Hook 注册文件：${relativePath}`);
  }

  const raw = await readProjectFile(root, relativePath);
  if (raw === null) return null;
  const content = raw.toString('utf8');

  if (relativePath === AGENTS_PATH) {
    const section = extractMarkedSection(content, AGENTS_START, AGENTS_END, relativePath);
    return section === null ? null : sha256(section);
  }
  if (relativePath === CODEX_CONFIG_PATH) {
    const section = extractMarkedSection(content, CODEX_START, CODEX_END, relativePath);
    if (section !== markedSection(CODEX_START, codexHookBody(), CODEX_END)) {
      return null;
    }
    return sha256(section);
  }

  let settings;
  try {
    settings = JSON.parse(content);
  } catch {
    throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 不是有效 JSON`);
  }
  const entries = settings?.hooks?.PreToolUse;
  if (!Array.isArray(entries)) return null;
  const matches = entries.filter((entry) => isFallaClaudeHook(entry));
  if (matches.length > 1) {
    throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 包含重复 Falla Hook`);
  }
  return matches.length === 0 ? null : stableHash(matches[0]);
}

async function planClaudeSettings(root, previousHash) {
  const command = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/falla-spec-guard.mjs"';
  const desired = { matcher: 'Skill', hooks: [{ type: 'command', command }] };
  const desiredHash = stableHash(desired);
  const raw = await readProjectFile(root, CLAUDE_SETTINGS_PATH);
  let settings = {};
  if (raw !== null) {
    try {
      settings = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 不是有效 JSON`);
    }
    if (!isRecord(settings)) throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 必须是 JSON 对象`);
  }
  if (settings.hooks !== undefined && !isRecord(settings.hooks)) {
    throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 的 hooks 必须是对象`);
  }
  settings.hooks ??= {};
  if (settings.hooks.PreToolUse !== undefined && !Array.isArray(settings.hooks.PreToolUse)) {
    throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 的 PreToolUse 必须是数组`);
  }
  const entries = settings.hooks.PreToolUse ?? [];
  const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => isFallaClaudeHook(entry));
  if (matches.length > 1) throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 包含重复 Falla Hook`);

  if (matches.length === 0) {
    if (previousHash) throw new FallaError(1, `用户修改的 Hook 注册不能覆盖：${CLAUDE_SETTINGS_PATH}`);
    entries.push(desired);
  } else {
    const currentHash = stableHash(matches[0].entry);
    if (currentHash !== desiredHash && currentHash !== previousHash) {
      throw new FallaError(1, `用户修改的 Hook 注册不能覆盖：${CLAUDE_SETTINGS_PATH}`);
    }
    entries[matches[0].index] = desired;
  }
  settings.hooks.PreToolUse = entries;
  const content = `${JSON.stringify(settings, null, 2)}\n`;
  return {
    relativePath: CLAUDE_SETTINGS_PATH,
    content,
    managedHash: desiredHash,
    action: raw?.toString('utf8') === content ? 'skip' : 'write',
  };
}

async function planClaudeSettingsRemoval(root, previousHash) {
  const raw = await readProjectFile(root, CLAUDE_SETTINGS_PATH);
  if (raw === null) {
    return { relativePath: CLAUDE_SETTINGS_PATH, content: '', action: 'skip' };
  }
  let settings;
  try {
    settings = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 不是有效 JSON`);
  }
  if (!isRecord(settings)) throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 必须是 JSON 对象`);
  const entries = settings?.hooks?.PreToolUse;
  if (entries === undefined) {
    return { relativePath: CLAUDE_SETTINGS_PATH, content: raw, action: 'skip' };
  }
  if (!Array.isArray(entries)) {
    throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 的 PreToolUse 必须是数组`);
  }
  const matches = entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isFallaClaudeHook(entry));
  if (matches.length > 1) throw new FallaError(1, `${CLAUDE_SETTINGS_PATH} 包含重复 Falla Hook`);
  if (matches.length === 0) {
    return { relativePath: CLAUDE_SETTINGS_PATH, content: raw, action: 'skip' };
  }
  if (stableHash(matches[0].entry) !== previousHash) {
    throw new FallaError(1, `用户修改的 Hook 注册不能删除：${CLAUDE_SETTINGS_PATH}`);
  }
  entries.splice(matches[0].index, 1);
  return {
    relativePath: CLAUDE_SETTINGS_PATH,
    content: `${JSON.stringify(settings, null, 2)}\n`,
    expectedFileHash: sha256(raw),
    action: 'write',
  };
}

export async function planHookRegistrations(root, toolIds, previousFiles = {}) {
  const plans = [];
  if (toolIds.includes('claude')) {
    plans.push(await planClaudeSettings(root, previousFiles[CLAUDE_SETTINGS_PATH]));
  }
  if (toolIds.includes('codex')) {
    plans.push(await planMarker(
      root,
      CODEX_CONFIG_PATH,
      CODEX_START,
      codexHookBody(),
      CODEX_END,
      previousFiles[CODEX_CONFIG_PATH]
    ));
    plans.push(await planMarker(
      root,
      AGENTS_PATH,
      AGENTS_START,
      AGENTS_BODY,
      AGENTS_END,
      previousFiles[AGENTS_PATH]
    ));
  }
  return plans;
}

export async function planHookRemovals(root, relativePaths, previousFiles = {}) {
  const plans = [];
  for (const relativePath of [...new Set(relativePaths)].sort()) {
    if (!isHookRegistrationPath(relativePath)) {
      throw new FallaError(1, `不是受支持的 Hook 注册文件：${relativePath}`);
    }
    if (relativePath === CLAUDE_SETTINGS_PATH) {
      plans.push(await planClaudeSettingsRemoval(root, previousFiles[relativePath]));
    } else if (relativePath === CODEX_CONFIG_PATH) {
      plans.push(await planMarkerRemoval(
        root, relativePath, CODEX_START, CODEX_END, previousFiles[relativePath]
      ));
    } else {
      plans.push(await planMarkerRemoval(
        root, relativePath, AGENTS_START, AGENTS_END, previousFiles[relativePath]
      ));
    }
  }
  return plans;
}

export async function applyHookRegistrationPlan(root, plans) {
  for (const plan of plans) {
    if (plan.action === 'write') {
      await writeAtomicFile(root, plan.relativePath, plan.content);
    }
  }
}

export async function applyHookRemovalPlan(root, plans) {
  for (const plan of plans) {
    if (plan.action === 'write') {
      const current = await readProjectFile(root, plan.relativePath);
      if (current === null || sha256(current) !== plan.expectedFileHash) {
        throw new FallaError(1, `用户修改的 Hook 注册不能删除：${plan.relativePath}`);
      }
      await writeAtomicFile(root, plan.relativePath, plan.content);
    }
  }
}
