import assert from 'node:assert/strict';
import test from 'node:test';

import { makeLegacyProject } from '../helpers/legacy-project.js';
import { snapshotTree } from '../helpers/snapshot.js';
import { migrateProject } from '../../src/commands/migrate.js';

test('migrateProject 把目标最终校验失败交给事务自动回滚', async () => {
  const root = await makeLegacyProject();
  const before = await snapshotTree(root);
  await assert.rejects(
    () => migrateProject({
      root,
      apply: true,
      validateCandidate: async () => {},
      validateTarget: async () => { throw new Error('target validation failed'); },
    }),
    (error) => error.code === 4 && error.message.includes('已回滚')
  );
  assert.deepEqual(await snapshotTree(root), before);
});
