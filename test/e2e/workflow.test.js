import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { snapshotTree } from '../helpers/snapshot.js';

const execFileAsync = promisify(execFile);
const cli = path.resolve('bin/falla-openspec.js');

async function put(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function runCli(args) {
  try {
    const result = await execFileAsync(process.execPath, [cli, ...args], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

async function makeValidLegacyProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-e2e-'));
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  await put(root, 'mercuryspec/config.yaml', 'schema: spec-driven\n');
  await put(root, 'mercuryspec/specs/chat/spec.md', `# Chat Specification

## Purpose
Provide a predictable greeting when a user opens chat so the first interaction is clear and testable.

## Requirements

### Requirement: Greeting
The system SHALL show a greeting.

#### Scenario: Greeting shown
- **WHEN** the chat opens
- **THEN** a greeting is visible
`);
  await put(root, 'mercuryspec/changes/chat-flow/.openspec.yaml', 'schema: spec-driven\ncreated: 2026-09-08\n');
  await put(root, 'mercuryspec/changes/chat-flow/proposal.md', '# Proposal\n');
  await put(root, 'mercuryspec/changes/chat-flow/design.md', '# Design\n');
  await put(root, 'mercuryspec/changes/chat-flow/tasks.md', '- [x] 1.1 implement\n');
  await put(root, 'mercuryspec/changes/chat-flow/specs/chat/spec.md', `## ADDED Requirements

### Requirement: Greeting
The system SHALL show a greeting.

#### Scenario: Greeting shown
- **WHEN** the chat opens
- **THEN** a greeting is visible
`);
  await put(
    root,
    'mercuryspec/changes/chat-flow/changes/ui/.openspec.yaml',
    'schema: task-driven\ncreated: 2026-09-08\nparent: chat-flow\n'
  );
  await put(root, 'mercuryspec/changes/chat-flow/changes/ui/tasks.md', '- [x] 1.1 UI\n');
  await put(root, 'mercuryspec/changes/chat-flow/changes/ui/comate.md', `# comate

- 负责人 (owner): tester
- 状态 (status): done
- 依赖 (depends-on): []
- 被依赖 (blocks): []
- 交接 (handoff): verified
`);
  return root;
}

test('CLI 完成 install、dry-run、apply、官方 validate、resolve 和 rollback', async () => {
  const root = await makeValidLegacyProject();
  const sourceBefore = await snapshotTree(path.join(root, 'mercuryspec'));

  const install = await runCli(['install', root, '--tools', 'codex', '--non-interactive', '--json']);
  assert.equal(install.code, 0, install.stderr);
  assert.equal(JSON.parse(install.stdout).ok, true);

  const dryRun = await runCli(['migrate', root, '--json']);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).dryRun, true);

  const apply = await runCli(['migrate', root, '--apply', '--json']);
  assert.equal(apply.code, 0, apply.stderr);
  const migration = JSON.parse(apply.stdout);
  assert.match(migration.id, /^[0-9TZ.-]+-[a-f0-9]{8}$/);

  const validation = await execFileAsync('openspec', ['validate', '--all', '--strict'], { cwd: root });
  assert.doesNotMatch(validation.stderr, /failed/i);
  const resolve = await runCli([
    'coordination', 'resolve', 'chat-flow/ui', '--project', root, '--json',
  ]);
  assert.equal(resolve.code, 0, resolve.stderr);
  assert.equal(JSON.parse(resolve.stdout).physical, 'chat-flow-child-ui');
  assert.deepEqual(await snapshotTree(path.join(root, 'mercuryspec')), sourceBefore);

  const rollback = await runCli(['migrate', root, '--rollback', migration.id, '--json']);
  assert.equal(rollback.code, 0, rollback.stderr);
  assert.equal(JSON.parse(rollback.stdout).rolledBack, true);
  await assert.rejects(
    () => readFile(path.join(root, 'openspec', 'changes', 'chat-flow-child-ui', 'tasks.md')),
    (error) => error.code === 'ENOENT'
  );
});

test('migrate 不提供 --force 且错误输出不含调用栈', async () => {
  const root = await makeValidLegacyProject();
  const result = await runCli(['migrate', root, '--force']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /未知参数/);
  assert.doesNotMatch(result.stderr, /at .*\(/);
});
