import { FallaError } from '../errors.js';
import { assertChangeSegment, parseLogicalReference } from './naming.js';

const MAX_COMATE_BYTES = 256 * 1024;
const STATUSES = new Set(['todo', 'in-progress', 'blocked', 'done']);

const FIELDS = {
  owner: /^- 负责人 \(owner\):[ \t]*(.*)$/gm,
  status: /^- 状态 \(status\):[ \t]*(.*)$/gm,
  dependsOn: /^- 依赖 \(depends-on\):[ \t]*(.*)$/gm,
  blocks: /^- 被依赖 \(blocks\):[ \t]*(.*)$/gm,
  handoff: /^- 交接 \(handoff\):[ \t]*(.*)$/gm,
};

function readSingleField(markdown, name, pattern, source) {
  const matches = [...markdown.matchAll(pattern)];
  if (matches.length === 0) throw new FallaError(1, `${source} 缺少 ${name} 字段`);
  if (matches.length > 1) throw new FallaError(1, `${source} 的 ${name} 字段重复`);
  return matches[0][1].trim();
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
  const owner = readSingleField(markdown, 'owner', FIELDS.owner, source);
  const status = readSingleField(markdown, 'status', FIELDS.status, source);
  const dependsOnRaw = readSingleField(markdown, 'depends-on', FIELDS.dependsOn, source);
  const blocksRaw = readSingleField(markdown, 'blocks', FIELDS.blocks, source);
  const handoff = readSingleField(markdown, 'handoff', FIELDS.handoff, source);

  if (!owner) throw new FallaError(1, `${source} 的 owner 不能为空`);
  if (!STATUSES.has(status)) throw new FallaError(1, `${source} 的 status 无效`);

  return {
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
    const match = line.match(/^- \[([ xX])\]\s+/);
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
  if (record.status === 'blocked' && !record.handoff) {
    issues.push({ kind: 'blocked-handoff-required' });
  }
  if (record.status === 'done' && pendingTasks > 0) {
    issues.push({ kind: 'tasks-incomplete', count: pendingTasks });
  }
  if (record.status === 'done' && !record.handoff) {
    issues.push({ kind: 'done-handoff-required' });
  }
  return issues;
}
