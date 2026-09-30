import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';
import { sha256, writeAtomicFile } from '../install/files.js';
import { withProjectLock } from '../locks.js';
import { parseComate, parseTaskProgress, validateComateRecord } from './comate.js';
import { validateCoordination } from './dag.js';
import { readChangeRecordFile } from './health.js';
import { resolveChange } from './resolver.js';
import { loadCoordination } from './store.js';
import { assertOwner } from './owner.js';
import { loadBaselineState } from './baseline-files.js';
import { baselineError, writeBaselineField } from './baseline.js';

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
    const progress = tasks === null ? null : parseTaskProgress(tasks);
    if (progress === null || validateComateRecord(record, {
      pendingTasks: progress.pending,
      humanTasks: progress.humanTasks,
      taskIssues: progress.issues,
    }).length > 0) {
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
    // 一次锁内认领共用官方状态快照，避免同一节点重复启动 CLI；下一次认领重新读取。
    const statuses = new Map();
    const statusProvider = async physical => {
      if (!statuses.has(physical)) statuses.set(physical, options.statusProvider(physical));
      return statuses.get(physical);
    };
    const resolved = await resolveChange(root, reference);
    if (resolved.lifecycle !== 'active') throw new FallaError(1, '已归档 change 不可认领');

    const official = await statusProvider(resolved.physical);
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
      const parentOfficial = await statusProvider(parent.physical);
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
      await assertDependenciesDone(root, parentRecord.dependsOn, statusProvider);
    }

    if (record.status === 'blocked') throw new FallaError(1, 'blocked change 不会自动重启');
    if (record.status === 'done') throw new FallaError(1, 'done change 不会自动重启');
    const tasks = await readChangeRecordFile(root, resolved.path, 'tasks.md', true);
    const progress = tasks === null ? null : parseTaskProgress(tasks);
    // 新认领和幂等重试共用完成校验器，拒绝已知冲突且不落盘任何部分状态。
    if (progress === null || validateComateRecord(record, {
      pendingTasks: progress.pending, humanTasks: progress.humanTasks,
      taskIssues: progress.issues,
    }).length > 0) {
      throw new FallaError(1, '当前 change 验证未通过，不能认领');
    }
    if (record.status === 'in-progress') {
      if (record.owner !== owner) throw new FallaError(1, 'change 已由其他 owner 认领，不可抢占');
    }
    if (!['todo', 'in-progress'].includes(record.status)) throw new FallaError(1, 'change 状态不可认领');
    if (record.owner !== 'unassigned' && record.owner !== owner) {
      throw new FallaError(1, 'change 已由其他 owner 认领，不可抢占');
    }

    await assertDependenciesDone(root, record.dependsOn, statusProvider);
    const validation = await validateCoordination(root, {
      change: logicalChild ? resolved.parent : resolved.physical, statusProvider,
    });
    const preflightErrors = validation.errors.filter(error => error.kind.startsWith('preflight-'));
    if (preflightErrors.length > 0) {
      throw new FallaError(1, 'Preflight 准入未通过：请核对父 preflight.md 的阻塞项与确认依据', {
        kind: 'preflight-admission-failed', errors: preflightErrors,
      });
    }
    if (validation.errors.some(error => !error.kind.startsWith('preflight-') && !error.kind.startsWith('baseline-'))) {
      throw new FallaError(1, '协作验证未通过，不能认领');
    }
    const baselineErrors = validation.errors.filter(error => error.kind.startsWith('baseline-'));
    if (baselineErrors.length > 0) throw baselineError('baseline-admission-failed');
    if (!validation.ok) throw new FallaError(1, '协作验证未通过，不能认领');
    if (record.status === 'in-progress') return claimResult(resolved.logical, false, true);
    const baseline = await loadBaselineState(root, reference);
    if (baseline.errors.length > 0 || baseline.markdown !== markdown) throw baselineError('baseline-input-changed');
    const initialized = baseline.snapshot ? markdown : writeBaselineField(markdown, baseline.current);
    const updated = updateClaimFields(initialized, owner);
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
