export function renderMigrationReport(plan) {
  const counts = { copy: 0, write: 0, skip: 0, conflict: 0 };
  const operations = plan.operations.map((operation) => {
    counts[operation.kind] += 1;
    return {
      kind: operation.kind,
      ...(operation.from ? { from: operation.from } : {}),
      ...(operation.to ? { to: operation.to } : {}),
      ...(operation.reason ? { reason: operation.reason } : {}),
      ...(operation.sha256 ? { sha256: operation.sha256 } : {}),
    };
  });
  const mappings = Object.fromEntries(Object.entries(plan.mappings).map(([logical, mapping]) => [
    logical,
    {
      physical: mapping.physical,
      parent: mapping.parent,
      lifecycle: mapping.lifecycle,
    },
  ]));
  return {
    version: plan.version,
    dryRun: true,
    counts,
    mappings,
    operations,
    warnings: plan.warnings.map((warning) => ({ path: warning.path, kind: warning.kind })),
  };
}
