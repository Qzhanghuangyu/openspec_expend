import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { assertStatusContract } from '../../src/openspec/contract.js';

const execFileAsync = promisify(execFile);
const schemaRoot = path.resolve('templates/openspec/schemas');

const schemas = [
  ['falla-spec-driven', 'preflight'],
  ['falla-task-driven', 'tasks'],
  ['falla-legacy-spec-driven', 'proposal'],
  ['falla-legacy-task-driven', 'tasks'],
];

async function createProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-openspec-schema-'));
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  return root;
}

test('四套 Falla Schema 均通过官方 OpenSpec 校验', async () => {
  const root = await createProject();

  for (const [name] of schemas) {
    await cp(path.join(schemaRoot, name), path.join(root, 'openspec', 'schemas', name), {
      recursive: true,
    });
    const { stdout } = await execFileAsync('openspec', ['schema', 'validate', name], {
      cwd: root,
    });
    assert.match(stdout, /valid/i, name);
  }
});

test('每套 Schema 创建的 change 由官方 status 识别首个可写 artifact', async () => {
  const root = await createProject();

  for (const [name, firstArtifact] of schemas) {
    await cp(path.join(schemaRoot, name), path.join(root, 'openspec', 'schemas', name), {
      recursive: true,
    });
    const change = `sample-${name}`;
    await execFileAsync('openspec', [
      'new', 'change', change, '--schema', name, '--json',
    ], { cwd: root });
    const { stdout } = await execFileAsync('openspec', [
      'status', '--change', change, '--json',
    ], { cwd: root });
    const status = assertStatusContract(JSON.parse(stdout));

    assert.equal(status.schemaName, name);
    assert.deepEqual(
      status.artifacts.filter((artifact) => artifact.status === 'ready').map(({ id }) => id),
      [firstArtifact]
    );
  }
});

test('新父子 Schema 的 apply 均以 comate 为前置', async () => {
  const root = await createProject();

  for (const name of ['falla-spec-driven', 'falla-task-driven']) {
    await cp(path.join(schemaRoot, name), path.join(root, 'openspec', 'schemas', name), {
      recursive: true,
    });
    const change = `apply-${name}`;
    await execFileAsync('openspec', [
      'new', 'change', change, '--schema', name, '--json',
    ], { cwd: root });
    const { stdout } = await execFileAsync('openspec', [
      'status', '--change', change, '--json',
    ], { cwd: root });

    assert.deepEqual(JSON.parse(stdout).applyRequires, ['comate']);
  }
});
