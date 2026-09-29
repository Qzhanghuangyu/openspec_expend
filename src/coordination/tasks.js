// 新任务使用版本标记启用完整格式门禁；旧任务保留已有编号，不做隐式迁移。
const ID = /^(?:[1-9]\d*(?:\.[1-9]\d*)*|T[1-9]\d*)$/u;
const CHAPTER_ID = /^[1-9]\d*\.[1-9]\d*$/u;

function readId(text) {
  const match = text.match(/^(?:\[人工\][ \t]*)?([1-9]\d*(?:\.[1-9]\d*)*|T[1-9]\d*)[.)]?(?=[ \t]|$)/u);
  return match && match[1].length <= 64 ? match[1] : null;
}

function dependencyFields(text) {
  return [...text.matchAll(/(?:^|[（(;；])[ \t]*(?:[-*+][ \t]+)?(?:\*\*)?(?:前置依赖|依赖)(?:\*\*)?[ \t]*[:：][ \t]*([^;；)）]*)/gu)]
    .map(match => match[1].trim());
}

function readDependencies(value) {
  if (/^(?:无|none|\[\s*\])$/iu.test(value)) return [];
  if (!value) return null;
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const ids = value.split(/[,，、]/u).map(part => part.trim().replace(/^`([^`]+)`$/u, '$1'));
  if (ids.some(id => id.length > 64 || !ID.test(id)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

function issue(kind, task, details = {}) {
  // 不携带正文或无法识别的原始编号/依赖值；稳定编号也限制了长度和字符集。
  return { kind, line: task.line, ...(task.id ? { task: task.id } : {}), ...details };
}

function scanTasks(markdown) {
  const tasks = [];
  const markers = [];
  const parents = [];
  let section = null;
  let separated = false;
  let fence = null;
  const lines = String(markdown).split('\n');
  for (const [index, line] of lines.entries()) {
    const indent = line.match(/^\s*/u)[0].length;
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/u);
    const inCode = fence !== null || fenceMatch !== null;
    if (fenceMatch) {
      const delimiter = fenceMatch[1];
      if (fence === null) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length && !fenceMatch[2].trim()) fence = null;
    }
    const checkbox = line.match(/^\s*[-*]\s*\[([\sxX])\]\s*(.*)/u);
    if (inCode) {
      // 官方仍统计围栏中的 checkbox；新契约拒绝此类歧义，旧记录只保留进度统计。
      if (checkbox) tasks.push({ line: index + 1, inCode: true });
      if (fenceMatch) {
        while (parents.length > 1 && parents.at(-1).indent >= indent) parents.pop();
        if (parents.length && indent <= parents.at(-1).indent) parents.length = 0;
      }
      continue;
    }
    if (/^\s*<!--\s*falla-tasks-format\b/u.test(line)) {
      markers.push({ line: index + 1, valid: /^\s*<!--\s*falla-tasks-format:\s*1\s*-->\s*$/u.test(line) });
      continue;
    }
    // 顶级标题允许 Markdown 的 0–3 个前导空格；列表内标题不切换任务章节。
    if (/^ {0,3}#{1,2}\s/u.test(line) && (!parents.length || indent < parents[0].indent + 2)) {
      section = line.trimStart().match(/^##\s+([1-9]\d*)[.)]?(?:\s|$)/u)?.[1] ?? null;
      parents.length = 0;
    }
    if (checkbox) {
      while (parents.length && parents.at(-1).indent >= indent) parents.pop();
      const task = {
        line: index + 1, indent, section, id: readId(checkbox[2]),
        done: checkbox[1].toLowerCase() === 'x', fields: dependencyFields(checkbox[2]),
      };
      tasks.push(task);
      parents.push(task);
      separated = false;
      continue;
    }
    if (!line.trim()) {
      separated = true;
      continue;
    }
    // 与进度解析采用相同的任务续行边界；子任务结束后可恢复父任务字段。
    while (parents.length > 1 && parents.at(-1).indent >= indent) parents.pop();
    const block = /^\s*(?:#{1,6}\s|`{3,}|~{3,}|[-*+]\s+|\d+[.)]\s+)/u.test(line);
    if (parents.length && indent <= parents.at(-1).indent && (separated || block)) parents.length = 0;
    if (parents.length) parents.at(-1).fields.push(...dependencyFields(line));
    separated = false;
  }
  return { tasks, markers };
}

function findTaskCycle(byId) {
  // 用显式栈遍历，避免接近文件大小上限的长依赖链耗尽 JavaScript 调用栈。
  const state = new Map();
  for (const start of byId.values()) {
    if (state.has(start.id)) continue;
    state.set(start.id, 'visiting');
    const stack = [{ task: start, index: 0 }];
    while (stack.length) {
      const frame = stack.at(-1);
      if (frame.index === frame.task.dependencies.length) {
        state.set(frame.task.id, 'done');
        stack.pop();
        continue;
      }
      const dependency = byId.get(frame.task.dependencies[frame.index++]);
      if (!dependency || dependency.id === frame.task.id) continue;
      if (state.get(dependency.id) === 'visiting') {
        return issue('task-dependency-cycle', frame.task, { relatedLine: dependency.line });
      }
      if (!state.has(dependency.id)) {
        state.set(dependency.id, 'visiting');
        stack.push({ task: dependency, index: 0 });
      }
    }
  }
  return null;
}

/** 校验本地任务图，只返回脱敏诊断；待执行任务依赖未完成任务本身是合法的。 */
export function validateTaskDependencies(markdown) {
  const { tasks, markers } = scanTasks(markdown);
  const strict = markers.some(marker => marker.valid);
  const issues = [];
  if (markers.length > 1 || markers.some(marker => !marker.valid)) {
    issues.push({ kind: 'task-format-invalid', line: markers[0].line });
  }
  const byId = new Map();
  for (const task of tasks) {
    if (task.inCode) {
      if (strict) issues.push(issue('task-checkbox-in-code', task));
      continue;
    }
    if ((strict && (!task.id || !CHAPTER_ID.test(task.id))) || (!task.id && task.fields.length)) {
      issues.push(issue('task-id-invalid', task));
    }
    if (strict && task.id && CHAPTER_ID.test(task.id) && task.id.split('.')[0] !== task.section) {
      issues.push(issue('task-section-mismatch', task));
    }
    if (task.id) {
      if (byId.has(task.id)) issues.push(issue('task-id-duplicate', task, { relatedLine: byId.get(task.id).line }));
      else byId.set(task.id, task);
    }
    if (strict && !task.fields.length) issues.push(issue('task-dependency-required', task));
    const dependencies = task.fields.length === 0 ? [] : task.fields.length === 1 ? readDependencies(task.fields[0]) : null;
    if (dependencies === null) issues.push(issue('task-dependency-invalid', task));
    task.dependencies = dependencies ?? [];
  }
  for (const task of tasks) {
    if (task.inCode || !task.id) continue;
    for (const id of task.dependencies) {
      const dependency = byId.get(id);
      if (!dependency) issues.push(issue('task-dependency-missing', task, { dependency: id }));
      else if (id === task.id) issues.push(issue('task-dependency-self', task));
      else {
        if (strict && dependency.line > task.line) {
          issues.push(issue('task-dependency-order', task, { relatedLine: dependency.line }));
        }
        if (task.done && !dependency.done) {
          issues.push(issue('task-dependency-not-done', task, { relatedLine: dependency.line }));
        }
      }
    }
  }
  const cycle = findTaskCycle(byId);
  if (cycle) issues.push(cycle);
  return issues;
}
