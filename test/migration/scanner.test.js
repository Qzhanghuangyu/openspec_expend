import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { makeLegacyProject } from '../helpers/legacy-project.js';
import { scanLegacyProject } from '../../src/migration/scanner.js';

test('扫描旧项目时分类业务规格、父子 change、归档、Schema 和规则', async () => {
  const root = await makeLegacyProject();
  const inventory = await scanLegacyProject(root);
  const kinds = new Map(inventory.files.map((file) => [file.path, file.kind]));

  assert.equal(kinds.get('mercuryspec/specs/chat/spec.md'), 'business-spec');
  assert.equal(kinds.get('mercuryspec/specs/[Must Read]soul.md'), 'legacy-workflow-rule');
  assert.equal(kinds.get('mercuryspec/changes/medal/proposal.md'), 'active-parent-change');
  assert.equal(kinds.get('mercuryspec/changes/medal/changes/detail/tasks.md'), 'active-child-change');
  assert.equal(
    kinds.get('mercuryspec/changes/archive/2026-07-20-profile/changes/avatar/tasks.md'),
    'archived-child-change'
  );
  assert.equal(
    kinds.get('mercuryspec/changes/archive/2026-07-21-flat-avatar/tasks.md'),
    'archived-child-change'
  );
  assert.deepEqual(
    inventory.files.find((file) =>
      file.path === 'mercuryspec/changes/archive/2026-07-21-flat-avatar/tasks.md').change,
    {
      date: '2026-07-21',
      parent: 'profile',
      child: 'flat-avatar',
      logical: 'profile/flat-avatar',
      lifecycle: 'archived',
    }
  );
  assert.equal(kinds.get('mercuryspec/schemas/custom/schema.yaml'), 'legacy-schema');
  assert.equal(kinds.get('.falla/skill-spec/[Must Read]soul.md'), 'current-rule');
  assert.equal(inventory.skipped[0].path, 'mercuryspec/.DS_Store');
  assert.ok(inventory.files.every((file) => !Object.hasOwn(file, 'content')));
});

test('扫描阻止项目外符号链接和敏感文件名', async () => {
  const root = await makeLegacyProject();
  const outside = path.join(path.dirname(root), 'outside-secret.txt');
  await writeFile(outside, 'secret\n');
  await symlink(outside, path.join(root, 'mercuryspec', 'specs', 'chat', 'outside.md'));
  await assert.rejects(
    () => scanLegacyProject(root),
    (error) => error.code === 1 && error.message.includes('项目外符号链接')
  );

  const sensitiveRoot = await makeLegacyProject();
  await mkdir(path.join(sensitiveRoot, 'mercuryspec', 'specs', 'secret'), { recursive: true });
  await writeFile(path.join(sensitiveRoot, 'mercuryspec', 'specs', 'secret', '.env'), 'TOKEN=x\n');
  await assert.rejects(
    () => scanLegacyProject(sensitiveRoot),
    (error) => error.code === 1 && error.message.includes('敏感文件') && !error.message.includes('TOKEN=x')
  );
});

test('扫描阻止未知二进制附件但允许 Figma JSON', async () => {
  const root = await makeLegacyProject();
  await writeFile(path.join(root, 'mercuryspec', 'specs', 'chat', 'payload.bin'), Buffer.from([0, 1, 2, 3]));
  await assert.rejects(
    () => scanLegacyProject(root),
    (error) => error.code === 1 && error.message.includes('异常二进制')
  );
});
