import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { makeLegacyProject } from '../helpers/legacy-project.js';
import { migrateProject } from '../../src/commands/migrate.js';

async function hashTree(root, relative = '') {
  const hash = createHash('sha256');
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${child}\0`);
    if (entry.isDirectory()) hash.update(await hashTree(root, child));
    else hash.update(await readFile(path.join(root, child)));
  }
  return hash.digest('hex');
}

test('migrate 默认 dry-run 且项目树零写入', async () => {
  const root = await makeLegacyProject();
  const before = await hashTree(root);
  const plan = await migrateProject({ root, apply: false });

  assert.equal(await hashTree(root), before);
  assert.equal(plan.mappings['medal/detail'].physical, 'medal-child-detail');
  assert.equal(plan.operations.some((operation) =>
    operation.to?.startsWith('openspec/specs/[Must Read]')), false);
});
