import assert from 'node:assert/strict';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { makeLegacyProject } from '../helpers/legacy-project.js';
import { snapshotTree } from '../helpers/snapshot.js';
import { defaultFilesystem } from '../../src/filesystem.js';
import { planMigration } from '../../src/migration/planner.js';
import { scanLegacyProject } from '../../src/migration/scanner.js';
import {
  applyMigration,
  recoverInterruptedMigrations,
} from '../../src/migration/transaction.js';

async function migrationPlan(root) {
  return planMigration(root, await scanLegacyProject(root));
}

test('候选验证通过后应用计划且保持 mercuryspec 源不变', async () => {
  const root = await makeLegacyProject();
  const sourceBefore = await snapshotTree(path.join(root, 'mercuryspec'));
  const plan = await migrationPlan(root);
  let validated = false;

  const result = await applyMigration(root, plan, {
    validateCandidate: async (candidate) => {
      validated = true;
      assert.equal(
        await readFile(path.join(candidate, 'openspec', 'changes', 'medal-child-detail', 'tasks.md'), 'utf8'),
        '- [ ] child task\n'
      );
    },
  });

  assert.equal(validated, true);
  assert.match(result.id, /^[0-9TZ.-]+-[a-f0-9]{8}$/);
  assert.equal(await readFile(path.join(root, 'openspec', 'specs', 'chat', 'spec.md'), 'utf8'), '# Chat capability\n');
  assert.deepEqual(await snapshotTree(path.join(root, 'mercuryspec')), sourceBefore);
  await access(path.join(root, '.falla', 'migration', result.id, 'journal.json'));
});

test('目标第三次写入失败后自动回滚且项目树精确恢复', async () => {
  const root = await makeLegacyProject();
  const canonicalRoot = await realpath(root);
  const before = await snapshotTree(root);
  const plan = await migrationPlan(root);
  let targetWrites = 0;
  const fs = {
    ...defaultFilesystem,
    writeAtomic: async (base, relative, content) => {
      if (base === canonicalRoot && ++targetWrites === 3) throw new Error('injected write failure');
      return defaultFilesystem.writeAtomic(base, relative, content);
    },
  };

  await assert.rejects(
    () => applyMigration(root, plan, { fs, validateCandidate: async () => {} }),
    (error) => error.code === 4 && error.message.includes('已回滚')
  );
  assert.deepEqual(await snapshotTree(root), before);
});

test('候选校验失败和计划冲突都在目标写入前停止', async () => {
  const root = await makeLegacyProject();
  const before = await snapshotTree(root);
  const plan = await migrationPlan(root);
  await assert.rejects(
    () => applyMigration(root, plan, {
      validateCandidate: async () => { throw new Error('candidate invalid'); },
    }),
    (error) => error.code === 1 && error.message.includes('候选校验失败')
  );
  assert.deepEqual(await snapshotTree(root), before);

  const conflictRoot = await makeLegacyProject();
  await mkdir(path.join(conflictRoot, 'openspec', 'specs', 'chat'), { recursive: true });
  await writeFile(path.join(conflictRoot, 'openspec', 'specs', 'chat', 'spec.md'), 'different\n');
  const conflictPlan = await migrationPlan(conflictRoot);
  const conflictBefore = await snapshotTree(conflictRoot);
  let called = false;
  await assert.rejects(
    () => applyMigration(conflictRoot, conflictPlan, {
      validateCandidate: async () => { called = true; },
    }),
    (error) => error.code === 1 && error.message.includes('冲突')
  );
  assert.equal(called, false);
  assert.deepEqual(await snapshotTree(conflictRoot), conflictBefore);
});

test('残留 writing journal 可在下一次操作前恢复', async () => {
  const root = await makeLegacyProject();
  const before = await snapshotTree(root);
  const migration = await applyMigration(root, await migrationPlan(root), {
    validateCandidate: async () => {},
  });
  const journalPath = path.join(root, '.falla', 'migration', migration.id, 'journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  journal.phase = 'writing';
  journal.appliedCount = Math.floor(journal.operations.length / 2);
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

  const recovered = await recoverInterruptedMigrations(root);
  assert.deepEqual(recovered, [migration.id]);
  assert.deepEqual(await snapshotTree(root), before);
});

test('目标写入后的最终校验失败也会自动回滚', async () => {
  const root = await makeLegacyProject();
  const before = await snapshotTree(root);
  const plan = await migrationPlan(root);
  await assert.rejects(
    () => applyMigration(root, plan, {
      validateCandidate: async () => {},
      validateTarget: async () => { throw new Error('target invalid'); },
    }),
    (error) => error.code === 4 && error.message.includes('已回滚')
  );
  assert.deepEqual(await snapshotTree(root), before);
});

test('最终校验期间目标被人工修改时自动回滚拒绝覆盖', async () => {
  const root = await makeLegacyProject();
  const target = path.join(root, '.falla', 'coordination.yaml');
  await writeFile(target, 'version: 1\nmappings: {}\n');
  const userEdit = 'user edit during final validation\n';
  const plan = await migrationPlan(root);

  await assert.rejects(
    () => applyMigration(root, plan, {
      validateCandidate: async () => {},
      validateTarget: async () => {
        await writeFile(target, userEdit);
        throw new Error('target invalid');
      },
    }),
    (error) => error.code === 5 && error.message.includes('目标又被修改')
  );
  assert.equal(await readFile(target, 'utf8'), userEdit);
});
