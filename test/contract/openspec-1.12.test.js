import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertArchiveInstructionsContract,
  assertInstructionsContract,
  assertListContract,
  assertStatusAllContract,
  assertStatusContract,
} from '../../src/openspec/contract.js';
import { assertSupportedVersion } from '../../src/openspec/version.js';

const execFileAsync = promisify(execFile);

async function runJson(args, cwd) {
  const { stdout } = await execFileAsync('openspec', args, { cwd });
  return JSON.parse(stdout);
}

test('本机 OpenSpec 满足 Falla 使用的公开 JSON 契约', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-openspec-contract-'));
  const canonicalRoot = await realpath(root);
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  await writeFile(path.join(root, 'openspec', 'config.yaml'), `schema: spec-driven
context: |
  Use project conventions.
operations:
  apply:
    guidance:
      - Run focused tests.
  archive:
    guidance:
      - Keep summaries concise.
`);
  await execFileAsync('openspec', [
    'new', 'change', 'contract-sample', '--schema', 'spec-driven', '--json',
  ], { cwd: root });

  assertSupportedVersion((await execFileAsync('openspec', ['--version'], { cwd: root })).stdout);
  assertListContract(await runJson(['list', '--json'], root));
  const initialStatus = assertStatusContract(
    await runJson(['status', '--change', 'contract-sample', '--json'], root)
  );
  assert.equal(initialStatus.isPlanningComplete, false);
  assert.equal(
    initialStatus.changeRoot,
    path.join(canonicalRoot, 'openspec', 'changes', 'contract-sample')
  );
  assert.deepEqual(initialStatus.artifactPaths.proposal.existingOutputPaths, []);
  assert.equal(
    initialStatus.isPlanningComplete,
    initialStatus.artifacts.every(({ status }) => status === 'done' || status === 'skipped')
  );
  assertInstructionsContract(await runJson([
    'instructions', 'proposal', '--change', 'contract-sample', '--json',
  ], root));
  const applyInstructions = assertInstructionsContract(await runJson([
    'instructions', 'apply', '--change', 'contract-sample', '--json',
  ], root));
  assert.equal(applyInstructions.context, 'Use project conventions.\n');
  assert.deepEqual(applyInstructions.operationGuidance, ['Run focused tests.']);
  const archiveInstructions = assertArchiveInstructionsContract(await runJson([
    'instructions', 'archive', '--change', 'contract-sample', '--json',
  ], root));
  assert.equal(archiveInstructions.context, 'Use project conventions.\n');
  assert.deepEqual(archiveInstructions.operationGuidance, ['Keep summaries concise.']);

  const changeDir = path.join(root, 'openspec', 'changes', 'contract-sample');
  const canonicalChangeDir = path.join(canonicalRoot, 'openspec', 'changes', 'contract-sample');
  await writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
  await writeFile(path.join(changeDir, 'design.md'), '# Design\n');
  await mkdir(path.join(changeDir, 'specs', 'sample'), { recursive: true });
  await writeFile(path.join(changeDir, 'specs', 'sample', 'spec.md'), `## ADDED Requirements

### Requirement: Sample
The system SHALL work.

#### Scenario: Works
- **WHEN** used
- **THEN** it works
`);
  await writeFile(path.join(changeDir, 'tasks.md'), '- [x] 1.1 done\n');
  const completeStatus = assertStatusContract(
    await runJson(['status', '--change', 'contract-sample', '--json'], root)
  );
  assert.equal(completeStatus.isPlanningComplete, true);
  assert.deepEqual(completeStatus.artifactPaths.specs.existingOutputPaths, [
    path.join(canonicalChangeDir, 'specs', 'sample', 'spec.md'),
  ]);
  assert.equal(
    completeStatus.isPlanningComplete,
    completeStatus.artifacts.every(({ status }) => status === 'done' || status === 'skipped')
  );
  const completeApply = assertInstructionsContract(await runJson([
    'instructions', 'apply', '--change', 'contract-sample', '--json',
  ], root));
  assert.deepEqual(completeApply.contextFiles.tasks, [path.join(canonicalChangeDir, 'tasks.md')]);
  assert.deepEqual(completeApply.tasks, [{ id: '1', description: '1.1 done', done: true }]);

  await execFileAsync('openspec', [
    'new', 'change', 'skip-specs-sample', '--schema', 'spec-driven', '--json',
  ], { cwd: root });
  const skippedDir = path.join(root, 'openspec', 'changes', 'skip-specs-sample');
  await writeFile(
    path.join(skippedDir, '.openspec.yaml'),
    'schema: spec-driven\nskip_specs: true\n'
  );
  await writeFile(path.join(skippedDir, 'proposal.md'), '# Proposal\n');
  await writeFile(path.join(skippedDir, 'design.md'), '# Design\n');
  await writeFile(path.join(skippedDir, 'tasks.md'), '- [x] 1.1 done\n');
  const skippedStatus = assertStatusContract(
    await runJson(['status', '--change', 'skip-specs-sample', '--json'], root)
  );
  assert.equal(skippedStatus.isPlanningComplete, true);
  assert.equal(skippedStatus.artifacts.find(({ id }) => id === 'specs').status, 'skipped');
  assert.deepEqual(skippedStatus.artifactPaths.specs.existingOutputPaths, []);

  const allStatus = assertStatusAllContract(await runJson(['status', '--all', '--json'], root));
  assert.deepEqual(
    allStatus.changes.map(({ changeName }) => changeName),
    ['contract-sample', 'skip-specs-sample']
  );
});
