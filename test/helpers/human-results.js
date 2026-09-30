/** 测试夹具显式提供人工结果，不从 checkbox 或反馈正文推断通过。 */
export function withHumanTaskResults(markdown, results) {
  const field = `- 人工任务结果 (human-task-results): ${JSON.stringify(results)}`;
  return /^- 人工任务结果 \(human-task-results\):/mu.test(markdown)
    ? markdown.replace(/^- 人工任务结果 \(human-task-results\):.*$/mu, field)
    : markdown.replace('- 依赖 (depends-on):', `${field}\n- 依赖 (depends-on):`);
}
