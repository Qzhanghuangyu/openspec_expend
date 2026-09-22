import { FallaError } from '../errors.js';
import { assertChangeSegment, parseLogicalReference } from './naming.js';

const MAX_COMATE_BYTES = 256 * 1024;
const STATUSES = new Set(['todo', 'in-progress', 'blocked', 'done']);
const VALIDATION_MODES = new Set(['hybrid', 'human', 'agent']);
const HUMAN_REVIEW_STATUSES = new Set(['pending', 'passed', 'failed', 'not-required']);

const FIELDS = {
  executionMode: /^- 执行模式 \(execution-mode\):[ \t]*(.*)$/gm,
  validationMode: /^- 验证模式 \(validation-mode\):[ \t]*(.*)$/gm,
  humanReview: /^- 人工验证状态 \(human-review\):[ \t]*(.*)$/gm,
  owner: /^- 负责人 \(owner\):[ \t]*(.*)$/gm,
  status: /^- 状态 \(status\):[ \t]*(.*)$/gm,
  dependsOn: /^- 依赖 \(depends-on\):[ \t]*(.*)$/gm,
  blocks: /^- 被依赖 \(blocks\):[ \t]*(.*)$/gm,
  handoff: /^- 交接 \(handoff\):[ \t]*(.*)$/gm,
};

function readOptionalSingleField(markdown, name, pattern, source) {
  const matches = [...markdown.matchAll(pattern)];
  if (matches.length > 1) throw new FallaError(1, `${source} 的 ${name} 字段重复`);
  return matches.length === 0 ? null : matches[0][1].trim();
}

function readSingleField(markdown, name, pattern, source) {
  const matches = [...markdown.matchAll(pattern)];
  if (matches.length === 0) throw new FallaError(1, `${source} 缺少 ${name} 字段`);
  if (matches.length > 1) throw new FallaError(1, `${source} 的 ${name} 字段重复`);
  return matches[0][1].trim();
}

function readMultilineField(markdown, name, pattern, source) {
  const matches = [...markdown.matchAll(pattern)];
  if (matches.length === 0) throw new FallaError(1, `${source} 缺少 ${name} 字段`);
  if (matches.length > 1) throw new FallaError(1, `${source} 的 ${name} 字段重复`);

  const match = matches[0];
  const lineEnd = markdown.indexOf('\n', match.index);
  const continuation = lineEnd === -1 ? [] : markdown.slice(lineEnd + 1).split('\n');
  const lines = match[1].trim() ? [match[1].trim()] : [];
  for (const line of continuation) {
    if (/^(?:-\s+\S|#{1,6}\s+)/.test(line)) break;
    lines.push(line);
  }
  return lines.join('\n').trim();
}

function hasMeaningfulHandoff(value) {
  return String(value).split('\n').some((line) => {
    const content = line.trim().replace(/^[-*]\s+/, '').trim();
    if (!content) return false;
    const label = content.match(/^[^:：]+[:：][ \t]*(.*)$/);
    return !label || Boolean(label[1].trim());
  });
}

function assertChangeReference(reference, source) {
  if (reference.includes('/')) return parseLogicalReference(reference).logical;
  return assertChangeSegment(reference, source);
}

function parseReferenceList(value, source) {
  if (!value.startsWith('[') || !value.endsWith(']')) {
    throw new FallaError(1, `${source} 必须使用 [change-a, change-b] 格式`);
  }
  const body = value.slice(1, -1).trim();
  if (!body) return [];
  const entries = body.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => !entry)) {
    throw new FallaError(1, `${source} 包含空引用`);
  }
  const normalized = entries.map((entry) => assertChangeReference(entry, source));
  if (new Set(normalized).size !== normalized.length) {
    throw new FallaError(1, `${source} 包含重复引用`);
  }
  return normalized;
}

export function parseComate(markdown, source = 'comate.md') {
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_COMATE_BYTES) {
    throw new FallaError(1, `${source} 无效或超过 256 KiB 限制`);
  }
  const executionMode = readOptionalSingleField(
    markdown,
    'execution-mode',
    FIELDS.executionMode,
    source
  );
  const validationMode = readOptionalSingleField(
    markdown,
    'validation-mode',
    FIELDS.validationMode,
    source
  );
  const humanReview = readOptionalSingleField(
    markdown,
    'human-review',
    FIELDS.humanReview,
    source
  );
  const owner = readSingleField(markdown, 'owner', FIELDS.owner, source);
  const status = readSingleField(markdown, 'status', FIELDS.status, source);
  const dependsOnRaw = readSingleField(markdown, 'depends-on', FIELDS.dependsOn, source);
  const blocksRaw = readSingleField(markdown, 'blocks', FIELDS.blocks, source);
  const handoff = readMultilineField(markdown, 'handoff', FIELDS.handoff, source);

  if (!owner) throw new FallaError(1, `${source} 的 owner 不能为空`);
  if (!STATUSES.has(status)) throw new FallaError(1, `${source} 的 status 无效`);
  if (executionMode !== null && executionMode !== 'single' && executionMode !== 'parallel') {
    throw new FallaError(1, `${source} 的 execution-mode 无效`);
  }
  if (validationMode !== null && !VALIDATION_MODES.has(validationMode)) {
    throw new FallaError(1, `${source} 的 validation-mode 无效`);
  }
  if (humanReview !== null && !HUMAN_REVIEW_STATUSES.has(humanReview)) {
    throw new FallaError(1, `${source} 的 human-review 无效`);
  }
  if (['hybrid', 'human'].includes(validationMode) && humanReview === null) {
    throw new FallaError(1, `${source} 的 ${validationMode} 模式缺少 human-review 字段`);
  }
  if (validationMode === 'agent' && humanReview !== null && humanReview !== 'not-required') {
    throw new FallaError(1, `${source} 的 agent 模式 human-review 必须为 not-required`);
  }
  if (validationMode === null && humanReview !== null) {
    throw new FallaError(1, `${source} 的 human-review 缺少 validation-mode`);
  }

  return {
    ...(executionMode === null ? {} : { executionMode }),
    ...(validationMode === null ? {} : { validationMode }),
    ...(humanReview === null ? {} : { humanReview }),
    owner,
    status,
    dependsOn: parseReferenceList(dependsOnRaw, `${source}.depends-on`),
    blocks: parseReferenceList(blocksRaw, `${source}.blocks`),
    handoff,
  };
}

export function parseTaskProgress(markdown) {
  let total = 0;
  let complete = 0;
  for (const line of String(markdown).split('\n')) {
    const match = line.match(/^\s*[-*]\s*\[([\sxX])\]\s*(.*)/);
    if (!match) continue;
    total += 1;
    if (match[1].toLowerCase() === 'x') complete += 1;
  }
  return { total, complete, pending: total - complete };
}

export function validateComateRecord(record, { pendingTasks }) {
  const issues = [];
  if (record.status !== 'todo' && record.owner === 'unassigned') {
    issues.push({ kind: 'owner-required' });
  }
  if (record.status === 'blocked' && !hasMeaningfulHandoff(record.handoff)) {
    issues.push({ kind: 'blocked-handoff-required' });
  }
  if (record.status === 'done' && pendingTasks > 0) {
    issues.push({ kind: 'tasks-incomplete', count: pendingTasks });
  }
  if (record.status === 'done' && !hasMeaningfulHandoff(record.handoff)) {
    issues.push({ kind: 'done-handoff-required' });
  }
  if (record.status === 'done' && ['hybrid', 'human'].includes(record.validationMode)
    && record.humanReview !== 'passed') {
    issues.push({ kind: 'human-review-required' });
  }
  return issues;
}
