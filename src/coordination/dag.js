import { FallaError } from '../errors.js';
import { assertChangeSegment } from './naming.js';
import { parseComate, parseTaskProgress, validateComateRecord } from './comate.js';
import { readChangeRecordFile } from './health.js';
import { resolveChange } from './resolver.js';
import { loadCoordination } from './store.js';

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
  const mappings = Object.entries(document.mappings)
    .filter(([, mapping]) => mapping.parent === parent)
    .sort(([left], [right]) => left.localeCompare(right));
  const errors = [];
  const warnings = [];
  const nodes = new Map();

  for (const [logical, mapping] of mappings) {
    try {
      const node = await readNode(root, logical, mapping, options.statusProvider);
      nodes.set(logical, node.comate);
      for (const localIssue of validateComateRecord(node.comate, {
        pendingTasks: node.tasks.pending,
      })) {
        const { kind, ...details } = localIssue;
        errors.push(issue(kind, logical, undefined,
          Object.keys(details).length > 0 ? details : undefined));
      }
      if (node.comate.status === 'done' && node.officialStatus?.isPlanningComplete === false) {
        errors.push(issue('artifacts-incomplete', logical));
      }
      if (node.resolved.lifecycle === 'archived' && node.comate.status !== 'done') {
        warnings.push(issue('archived-not-done', logical));
      }
    } catch (error) {
      errors.push(issue('invalid-node', logical, undefined, { message: error.message }));
    }
  }

  for (const [logical, record] of nodes) {
    for (const dependency of record.dependsOn) {
      const upstream = nodes.get(dependency);
      if (!upstream) {
        errors.push(issue('missing-dependency', logical, dependency));
        continue;
      }
      if ((record.status === 'in-progress' || record.status === 'done') && upstream.status !== 'done') {
        errors.push(issue('dependency-not-done', logical, dependency));
      }
    }
  }

  const cycle = findCycle(nodes);
  if (cycle) errors.push(issue('cycle', cycle[0], undefined, { path: cycle }));

  const ready = [];
  const blocked = [];
  for (const [logical, record] of nodes) {
    const dependenciesDone = record.dependsOn.every(
      (dependency) => nodes.get(dependency)?.status === 'done'
    );
    if (record.status === 'todo' && dependenciesDone) ready.push(logical);
    if (record.status === 'blocked' || (record.status === 'todo' && !dependenciesDone)) {
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
