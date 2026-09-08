import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { makeLegacyProject } from '../helpers/legacy-project.js';
import { snapshotTree } from '../helpers/snapshot.js';
import { planMigration } from '../../src/migration/planner.js';
import { scanLegacyProject } from '../../src/migration/scanner.js';
import { applyMigration, rollbackMigration } from '../../src/migration/transaction.js';
import { defaultFilesystem } from '../../src/filesystem.js';

async function applyFixture(root) {
  const plan = await planMigration(root, await scanLegacyProject(root));
  return applyMigration(root, plan, { validateCandidate: async () => {} });
}

test('显式回滚精确恢复迁移前文件和目录', async () => {
  const root = await makeLegacyProject();
  const before = await snapshotTree(root);
  const migration = await applyFixture(root);

  const result = await rollbackMigration(root, migration.id);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(await snapshotTree(root), before);
});

test('迁移后文件被用户修改时回滚拒绝覆盖', async () => {
  const root = await makeLegacyProject();
  const migration = await applyFixture(root);
  const target = path.join(root, 'openspec', 'specs', 'chat', 'spec.md');
  await writeFile(target, 'user edit after migration\n');

  await assert.rejects(
    () => rollbackMigration(root, migration.id),
    (error) => error.code === 1 && error.message.includes('迁移后已修改')
  );
  assert.equal(await readFile(target, 'utf8'), 'user edit after migration\n');
});

test('回滚无法删除迁移创建文件时返回错误码 5 并保留 journal', async () => {
  const root = await makeLegacyProject();
  const migration = await applyFixture(root);
  const fs = {
    ...defaultFilesystem,
    removeFile: async () => { throw new Error('injected rollback failure'); },
  };

  await assert.rejects(
    () => rollbackMigration(root, migration.id, { fs }),
    (error) => error.code === 5 && error.message.includes('回滚不完整')
  );
  assert.match(
    await readFile(path.join(root, '.falla', 'migration', migration.id, 'journal.json'), 'utf8'),
    /"phase": "applied"/
  );
});

test('回滚在接触目标文件前拒绝非规范 journal 路径', async () => {
  const root = await makeLegacyProject();
  const migration = await applyFixture(root);
  const journalPath = path.join(root, '.falla', 'migration', migration.id, 'journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  journal.operations[0].to = `openspec/../${journal.operations[0].to}`;
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

  await assert.rejects(
    () => rollbackMigration(root, migration.id),
    (error) => error.code === 1 && error.message.includes('journal 无效')
  );
});
