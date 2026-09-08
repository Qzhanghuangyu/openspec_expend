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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
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
    return section === null ? null : sha256(section);
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

export async function planHookRegistrations(root, toolIds, previousFiles = {}) {
  const plans = [];
  if (toolIds.includes('claude')) {
    plans.push(await planClaudeSettings(root, previousFiles[CLAUDE_SETTINGS_PATH]));
  }
  if (toolIds.includes('codex')) {
    const hookPath = `${root}/.codex/hooks/falla-spec-session.mjs`;
    const command = `node ${shellQuote(hookPath)}`;
    plans.push(await planMarker(
      root,
      CODEX_CONFIG_PATH,
      CODEX_START,
      `[[hooks.SessionStart]]\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(command)}`,
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

export async function applyHookRegistrationPlan(root, plans) {
  for (const plan of plans) {
    if (plan.action === 'write') {
      await writeAtomicFile(root, plan.relativePath, plan.content);
    }
  }
}
