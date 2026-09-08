import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertInstructionsContract,
  assertListContract,
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
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  await execFileAsync('openspec', [
    'new', 'change', 'contract-sample', '--schema', 'spec-driven', '--json',
  ], { cwd: root });

  assertSupportedVersion((await execFileAsync('openspec', ['--version'], { cwd: root })).stdout);
  assertListContract(await runJson(['list', '--json'], root));
  const initialStatus = assertStatusContract(
    await runJson(['status', '--change', 'contract-sample', '--json'], root)
  );
  assert.equal(initialStatus.isComplete, false);
  assert.equal(
    initialStatus.isComplete,
    initialStatus.artifacts.every(({ status }) => status === 'done')
  );
  assertInstructionsContract(await runJson([
    'instructions', 'proposal', '--change', 'contract-sample', '--json',
  ], root));
  assertInstructionsContract(await runJson([
    'instructions', 'apply', '--change', 'contract-sample', '--json',
  ], root));

  const changeDir = path.join(root, 'openspec', 'changes', 'contract-sample');
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
  assert.equal(completeStatus.isComplete, true);
  assert.equal(
    completeStatus.isComplete,
    completeStatus.artifacts.every(({ status }) => status === 'done')
  );
});
