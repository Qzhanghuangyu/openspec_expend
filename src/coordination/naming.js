import { createHash } from 'node:crypto';

import { FallaError } from '../errors.js';

const SEGMENT_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function assertChangeSegment(value, field = 'change') {
  if (typeof value !== 'string' || !SEGMENT_PATTERN.test(value)) {
    throw new FallaError(
      1,
      `${field} 必须使用小写 kebab-case；逻辑引用格式为 parent/child`
    );
  }
  return value;
}

export function parseLogicalReference(reference) {
  if (typeof reference !== 'string') {
    throw new FallaError(1, '逻辑 change 引用必须使用 parent/child');
  }
  const parts = reference.split('/');
  if (parts.length !== 2) {
    throw new FallaError(1, '逻辑 change 引用必须恰好使用 parent/child 两段');
  }
  const [parent, child] = parts;
  assertChangeSegment(parent, 'parent');
  assertChangeSegment(child, 'child');
  return { logical: `${parent}/${child}`, parent, child };
}

export function toPhysicalName(parent, child, occupied = new Set()) {
  assertChangeSegment(parent, 'parent');
  assertChangeSegment(child, 'child');
  const logical = `${parent}/${child}`;
  const base = `${parent}-child-${child}`;
  if (!occupied.has(base)) return base;

  const suffix = createHash('sha256').update(logical).digest('hex').slice(0, 8);
  const candidate = `${base}-${suffix}`;
  if (occupied.has(candidate)) {
    throw new FallaError(1, `无法为逻辑 change 分配唯一物理名：${logical}`);
  }
  return candidate;
}
