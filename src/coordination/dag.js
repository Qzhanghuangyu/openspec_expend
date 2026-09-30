import { FallaError } from '../errors.js';
import { assertChangeSegment } from './naming.js';
import { parseComate, parseTaskProgress, validateComateRecord } from './comate.js';
import { checkPreflight, readChangeRecordFile, validateParentRecord } from './health.js';
import { resolveChange } from './resolver.js';
import { loadCoordination } from './store.js';
import { inspectBaseline } from './baseline-files.js';

function issue(kind, change, related = undefined, details = undefined) {
  return {
    kind,
    change,
    ...(related ? { related } : {}),
    ...(details ? { details } : {}),
  };
}

function findCycle(records) {
  const state = new Map();
  const stack = [];

  function visit(logical) {
    state.set(logical, 'visiting');
    stack.push(logical);
    const record = records.get(logical);
    for (const dependency of record.dependsOn) {
      if (!records.has(dependency)) continue;
      if (state.get(dependency) === 'visiting') {
        return [...stack.slice(stack.indexOf(dependency)), dependency];
      }
      if (state.get(dependency) !== 'done') {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(logical, 'done');
    return null;
  }

  for (const logical of records.keys()) {
    if (!state.has(logical)) {
      const cycle = visit(logical);
      if (cycle) return cycle;
    }
  }
  return null;
}

async function readNode(root, logical, mapping, statusProvider) {
  const resolved = await resolveChange(root, logical);
  const markdown = await readChangeRecordFile(root, resolved.path, 'comate.md', true);
  if (markdown === null) throw new FallaError(1, `缺少 comate.md：${logical}`);
  const comate = parseComate(markdown, `${logical}/comate.md`);
  const taskMarkdown = await readChangeRecordFile(root, resolved.path, 'tasks.md', true);
  if (taskMarkdown === null) throw new FallaError(1, `缺少 tasks.md：${logical}`);
  const tasks = parseTaskProgress(taskMarkdown);

  const officialStatus = statusProvider && resolved.lifecycle === 'active'
    ? await statusProvider(mapping.physical)
    : null;
  return { logical, mapping, resolved, comate, tasks, officialStatus };
}

export async function validateCoordination(root, options) {
  const parent = assertChangeSegment(options.change, 'parent change');
  const document = await loadCoordination(root);
  const logicalByPhysical = new Map(Object.entries(document.mappings)
    .map(([logical, mapping]) => [mapping.physical, logical]));
  const childrenByParent = new Map();
  for (const [logical, mapping] of Object.entries(document.mappings)) {
    const children = childrenByParent.get(mapping.parent) ?? [];
    children.push(logical);
    childrenByParent.set(mapping.parent, children);
  }
  const canonical = reference => logicalByPhysical.get(reference) ?? reference;
  const normalize = record => ({ ...record, dependsOn: record.dependsOn.map(canonical) });
  const mappings = Object.entries(document.mappings)
    .filter(([, mapping]) => mapping.parent === parent)
    .sort(([left], [right]) => left.localeCompare(right));
  const errors = [];
  const warnings = [];
  const nodes = new Map();

  let parentNode = null;
  try {
    parentNode = await readNode(root, parent, { physical: parent }, options.statusProvider);
    for (const localIssue of validateComateRecord(parentNode.comate, {
      pendingTasks: parentNode.tasks.pending,
      humanTasks: parentNode.tasks.humanTasks,
      taskIssues: parentNode.tasks.issues,
    })) {
      const { kind, ...details } = localIssue;
      errors.push(issue(kind, parent, undefined,
        Object.keys(details).length > 0 ? details : undefined));
    }
    if (parentNode.comate.status === 'done' && parentNode.officialStatus?.isPlanningComplete === false) {
      errors.push(issue('artifacts-incomplete', parent));
    }
    if (parentNode.officialStatus?.schemaName === 'falla-spec-driven'
      && parentNode.comate.executionMode === 'parallel' && mappings.length === 0) {
      errors.push(issue('execution-mode-conflict', parent));
    }
    if (parentNode.officialStatus?.schemaName === 'falla-task-driven') {
      errors.push(issue('schema-mode-conflict', parent));
    }
    if (parentNode.resolved.lifecycle === 'archived' && parentNode.comate.status !== 'done') {
      warnings.push(issue('archived-not-done', parent));
    }
  } catch (error) {
    // 不回传异常正文：其中可能包含路径、文件内容或外部命令输出。
    errors.push(issue(error?.message?.startsWith('找不到物理 change：')
      ? 'missing-parent' : 'invalid-parent', parent));
  }

  for (const [logical, mapping] of mappings) {
    try {
      const node = await readNode(root, logical, mapping, options.statusProvider);
      nodes.set(logical, normalize(node.comate));
      for (const localIssue of validateComateRecord(node.comate, {
        pendingTasks: node.tasks.pending,
        humanTasks: node.tasks.humanTasks,
        taskIssues: node.tasks.issues,
      })) {
        const { kind, ...details } = localIssue;
        errors.push(issue(kind, logical, undefined,
          Object.keys(details).length > 0 ? details : undefined));
      }
      if (node.comate.status === 'done' && node.officialStatus?.isPlanningComplete === false) {
        errors.push(issue('artifacts-incomplete', logical));
      }
      if (node.officialStatus?.schemaName === 'falla-spec-driven'
        || (node.officialStatus?.schemaName === 'falla-task-driven'
          && node.comate.executionMode !== undefined)) {
        errors.push(issue('schema-mode-conflict', logical));
      }
      if (node.resolved.lifecycle === 'archived' && node.comate.status !== 'done') {
        warnings.push(issue('archived-not-done', logical));
      }
    } catch {
      errors.push(issue('invalid-node', logical));
    }
  }

  // claim 接受逻辑或物理的跨父依赖；校验也从真实 change 读取，不能只查本父映射。
  // 外部依赖只参与门禁，不加入当前父的 children、ready 或 blocked 集合。
  const dependencies = new Map(nodes);
  if (parentNode) dependencies.set(parent, normalize(parentNode.comate));
  // Map 迭代会访问新加入的节点；每个规范引用只加载一次，跨父依赖环也会终止遍历。
  for (const [reference, record] of dependencies) {
    if (!record) continue;
    // 被依赖的父记录也必须连同其子记录校验，不能用父 done 掩盖未完成子任务。
    const contextParent = document.mappings[reference]?.parent;
    for (const dependency of [...record.dependsOn, ...(childrenByParent.get(reference) ?? []),
      ...(contextParent ? [contextParent] : [])]) {
      if (dependencies.has(dependency)) continue;
      try {
        const resolved = await resolveChange(root, dependency);
        const node = await readNode(root, dependency, { physical: resolved.physical }, options.statusProvider);
        dependencies.set(dependency, normalize(node.comate));
        for (const localIssue of validateComateRecord(node.comate, {
          pendingTasks: node.tasks.pending, humanTasks: node.tasks.humanTasks,
          taskIssues: node.tasks.issues,
        })) {
          const { kind, ...details } = localIssue;
          errors.push(issue(kind, dependency, undefined, details));
        }
        if (node.comate.status === 'done' && node.officialStatus?.isPlanningComplete === false) {
          errors.push(issue('artifacts-incomplete', dependency));
        }
        if (document.mappings[dependency] && (node.comate.executionMode !== undefined
          || node.officialStatus?.schemaName === 'falla-spec-driven')) {
          errors.push(issue('schema-mode-conflict', dependency));
        }
        if (!document.mappings[dependency] && node.officialStatus?.schemaName === 'falla-spec-driven'
          && node.comate.executionMode === 'parallel' && !childrenByParent.has(dependency)) {
          errors.push(issue('execution-mode-conflict', dependency));
        }
      } catch {
        dependencies.set(dependency, null);
      }
    }
  }
  for (const [logical, record] of dependencies) {
    if (!record) continue;
    const contextParent = document.mappings[logical]?.parent;
    if (contextParent && dependencies.get(contextParent)?.status === 'blocked'
      && ['in-progress', 'done'].includes(record.status)) errors.push(issue('parent-blocked', logical, contextParent));
    errors.push(...validateParentRecord(logical, record,
      (childrenByParent.get(logical) ?? []).map(child => [child, dependencies.get(child)?.status])));
    const inherited = contextParent ? dependencies.get(contextParent)?.dependsOn ?? [] : [];
    for (const dependency of new Set([...record.dependsOn, ...inherited])) {
      const upstream = dependencies.get(dependency);
      if (!upstream) {
        errors.push(issue('missing-dependency', logical, dependency));
        continue;
      }
      if ((record.status === 'in-progress' || record.status === 'done') && upstream.status !== 'done') {
        errors.push(issue('dependency-not-done', logical, dependency));
      }
    }
  }

  // 父完成隐含依赖子完成；只在查环图加入该边，避免把父 in-progress 误当作执行依赖失败。
  const completionGraph = new Map([...dependencies]
    .filter(([, record]) => record !== null)
    .map(([reference, record]) => [reference, {
      ...record,
      dependsOn: [...record.dependsOn, ...(childrenByParent.get(reference) ?? []),
        ...(dependencies.get(document.mappings[reference]?.parent)?.dependsOn ?? [])],
    }]));
  const cycle = findCycle(completionGraph);
  if (cycle) errors.push(issue('cycle', cycle[0], undefined, { path: cycle }));

  // 每个可达父记录只检查一次；子 change 不能用自己的 preflight 覆盖父需求决定。
  const gateParents = new Set([...dependencies].filter(([, record]) => record !== null)
    .map(([reference]) => document.mappings[reference]?.parent ?? reference));
  for (const reference of gateParents) {
    try {
      errors.push(...(await checkPreflight(root, reference)).errors);
    } catch {
      errors.push(issue('preflight-unreadable', reference));
    }
  }
  if (!options.ignoreBaseline) {
    for (const [reference, record] of dependencies) {
      if (record !== null) errors.push(...(await inspectBaseline(root, reference)).errors);
    }
  }
  const admissionBlocked = errors.some(error => error.kind.startsWith('preflight-') || error.kind.startsWith('baseline-'));

  const ready = [];
  const blocked = [];
  for (const [logical, record] of nodes) {
    const inherited = dependencies.get(document.mappings[logical]?.parent)?.dependsOn ?? [];
    const dependenciesDone = [...record.dependsOn, ...inherited].every(
      (dependency) => dependencies.get(dependency)?.status === 'done'
    );
    if (record.status === 'todo' && dependenciesDone && !admissionBlocked) ready.push(logical);
    if (record.status === 'blocked' || (record.status === 'todo' && (!dependenciesDone || admissionBlocked))) {
      blocked.push(logical);
    }
  }

  return {
    ok: errors.length === 0,
    parent,
    errors,
    warnings,
    ready: ready.sort(),
    blocked: blocked.sort(),
  };
}
