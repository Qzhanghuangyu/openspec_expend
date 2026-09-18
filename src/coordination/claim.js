import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';
import { sha256, writeAtomicFile } from '../install/files.js';
import { withProjectLock } from '../locks.js';
import { parseComate, parseTaskProgress, validateComateRecord } from './comate.js';
import { readChangeRecordFile } from './health.js';
import { resolveChange } from './resolver.js';
import { loadCoordination } from './store.js';

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._@-]{0,63})$/;

function assertOwner(owner) {
  if (typeof owner !== 'string' || !OWNER_PATTERN.test(owner) || owner === 'unassigned') {
    throw new FallaError(1, 'owner 必须为 1-64 位字母、数字或 ._@- 字符');
  }
  return owner;
}

function updateClaimFields(markdown, owner) {
  let ownerCount = 0;
  let statusCount = 0;
  const updated = markdown
    .replace(/^(- 负责人 \(owner\):)[ \t]*.*$/gm, (_, prefix) => {
      ownerCount += 1;
      return `${prefix} ${owner}`;
    })
    .replace(/^(- 状态 \(status\):)[ \t]*.*$/gm, (_, prefix) => {
      statusCount += 1;
      return `${prefix} in-progress`;
    });
  if (ownerCount !== 1 || statusCount !== 1) {
    throw new FallaError(1, 'comate.md 的 owner/status 字段无效');
  }
  return updated;
}

async function assertDependenciesDone(root, dependencies, statusProvider) {
  for (const dependency of dependencies) {
    const resolved = await resolveChange(root, dependency);
    const markdown = await readChangeRecordFile(root, resolved.path, 'comate.md', true);
    if (markdown === null) throw new FallaError(1, `依赖尚未完成：${dependency}`);
    let record;
    try {
      record = parseComate(markdown, `${dependency}/comate.md`);
    } catch {
      throw new FallaError(1, `依赖记录无效：${dependency}`);
    }
    if (record.status !== 'done') throw new FallaError(1, `依赖尚未完成：${dependency}`);
    const tasks = await readChangeRecordFile(root, resolved.path, 'tasks.md', true);
    if (tasks === null || validateComateRecord(record, { pendingTasks: parseTaskProgress(tasks).pending }).length > 0) {
      throw new FallaError(1, `依赖验证未完成：${dependency}`);
    }
    if (resolved.lifecycle === 'active') {
      const official = await statusProvider(resolved.physical);
      if (official?.changeName !== resolved.physical || official.isPlanningComplete !== true) {
        throw new FallaError(1, `依赖规划未完成：${dependency}`);
      }
    }
  }
}

function claimResult(change, claimed, idempotent) {
  return { change, status: 'in-progress', claimed, idempotent };
}

export async function claimChange(rootInput, reference, options) {
  const owner = assertOwner(options?.owner);
  if (typeof options?.statusProvider !== 'function') {
    throw new FallaError(1, 'claim 缺少官方 status provider');
  }

  return withProjectLock(rootInput, 'coordination', async () => {
    const root = await realpath(path.resolve(rootInput));
    const resolved = await resolveChange(root, reference);
    if (resolved.lifecycle !== 'active') throw new FallaError(1, '已归档 change 不可认领');

    const official = await options.statusProvider(resolved.physical);
    if (official?.changeName !== resolved.physical) {
      throw new FallaError(1, '官方 status 与目标 change 不一致');
    }
    if (official.isPlanningComplete !== true) {
      throw new FallaError(1, '官方规划未完成，不能认领');
    }
    const logicalChild = String(reference).includes('/');
    const expectedSchema = logicalChild ? 'falla-task-driven' : 'falla-spec-driven';
    if (official.schemaName !== expectedSchema) {
      throw new FallaError(1, 'change schema 与认领模式不一致');
    }

    const markdown = await readChangeRecordFile(root, resolved.path, 'comate.md', true);
    if (markdown === null) throw new FallaError(1, 'change 缺少 comate.md');
    const record = parseComate(markdown, `${resolved.logical}/comate.md`);
    const coordination = await loadCoordination(root);
    const hasChildren = Object.values(coordination.mappings).some(mapping => mapping.parent === resolved.physical);
    if (!logicalChild && (record.executionMode === 'parallel' || hasChildren)) {
      throw new FallaError(1, 'parallel 父 change 必须认领逻辑子 change');
    }
    if (logicalChild && record.executionMode !== undefined) {
      throw new FallaError(1, '子 change 的 execution-mode 字段无效');
    }
    if (logicalChild) {
      const parent = await resolveChange(root, resolved.parent);
      const parentOfficial = await options.statusProvider(parent.physical);
      if (parent.lifecycle !== 'active' || parentOfficial?.changeName !== parent.physical
        || parentOfficial.schemaName !== 'falla-spec-driven' || parentOfficial.isPlanningComplete !== true) {
        throw new FallaError(1, '父 change 规划未完成或已归档，不能认领子 change');
      }
      const parentMarkdown = await readChangeRecordFile(root, parent.path, 'comate.md', true);
      if (parentMarkdown === null) throw new FallaError(1, '父 change 缺少协作记录');
      const parentRecord = parseComate(parentMarkdown);
      if (parentRecord.executionMode === 'single' || ['blocked', 'done'].includes(parentRecord.status)) {
        throw new FallaError(1, '父 change 模式或状态不允许认领子 change');
      }
      await assertDependenciesDone(root, parentRecord.dependsOn, options.statusProvider);
    }

    if (record.status === 'blocked') throw new FallaError(1, 'blocked change 不会自动重启');
    if (record.status === 'done') throw new FallaError(1, 'done change 不会自动重启');
    if (record.status === 'in-progress') {
      if (record.owner === owner) {
        await assertDependenciesDone(root, record.dependsOn, options.statusProvider);
        return claimResult(resolved.logical, false, true);
      }
      throw new FallaError(1, 'change 已由其他 owner 认领，不可抢占');
    }
    if (record.status !== 'todo') throw new FallaError(1, 'change 状态不可认领');
    if (record.owner !== 'unassigned' && record.owner !== owner) {
      throw new FallaError(1, 'change 已由其他 owner 认领，不可抢占');
    }

    await assertDependenciesDone(root, record.dependsOn, options.statusProvider);
    const updated = updateClaimFields(markdown, owner);
    const relativePath = path.relative(root, path.join(resolved.path, 'comate.md'))
      .split(path.sep).join('/');
    await writeAtomicFile(root, relativePath, updated, { expectedHash: sha256(markdown) });

    const verified = parseComate(
      await readChangeRecordFile(root, resolved.path, 'comate.md'),
      `${resolved.logical}/comate.md`
    );
    if (verified.owner !== owner || verified.status !== 'in-progress') {
      throw new FallaError(1, '认领写入复核失败');
    }
    return claimResult(resolved.logical, true, false);
  });
}
