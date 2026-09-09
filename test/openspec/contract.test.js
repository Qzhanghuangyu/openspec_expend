import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertArchiveInstructionsContract,
  assertInstructionsContract,
  assertListContract,
  assertStatusAllContract,
  assertStatusContract,
} from '../../src/openspec/contract.js';

test('list 契约允许新增字段并返回原对象', () => {
  const value = {
    changes: [{ name: 'add-auth', status: 'no-tasks', future: true }],
    root: { path: '/project', source: 'nearest' },
    future: true,
  };

  assert.equal(assertListContract(value), value);
});

test('status 契约拒绝缺失 changeName', () => {
  assert.throws(
    () => assertStatusContract({ schemaName: 'spec-driven', artifacts: [] }),
    (error) => error.code === 3 && error.details.field === 'status.changeName'
  );
});

test('status 契约校验实际消费的 artifact 字段', () => {
  const value = {
    changeName: 'add-auth',
    schemaName: 'spec-driven',
    isPlanningComplete: false,
    isComplete: false,
    artifacts: [{
      id: 'proposal', outputPath: 'proposal.md', status: 'ready', requires: [],
    }],
    applyRequires: ['tasks'],
    extra: { accepted: true },
  };

  assert.equal(assertStatusContract(value), value);
});

test('status 契约拒绝缺失实际消费的 isPlanningComplete', () => {
  assert.throws(
    () => assertStatusContract({
      changeName: 'add-auth',
      schemaName: 'spec-driven',
      artifacts: [],
    }),
    (error) => error.code === 3 && error.details.field === 'status.isPlanningComplete'
  );
});

test('status --all 契约校验批量状态信封', () => {
  const status = {
    changeName: 'add-auth',
    schemaName: 'spec-driven',
    isPlanningComplete: true,
    isComplete: true,
    artifacts: [{
      id: 'specs', outputPath: 'specs/**/*.md', status: 'skipped', requires: ['proposal'],
    }],
    applyRequires: ['tasks'],
  };
  const value = {
    changes: [status],
    root: { path: '/project', source: 'nearest' },
  };

  assert.equal(assertStatusAllContract(value), value);
});

test('instructions 契约区分 artifact 和 apply 输出', () => {
  const artifact = {
    changeName: 'add-auth',
    artifactId: 'proposal',
    schemaName: 'spec-driven',
    outputPath: 'proposal.md',
    resolvedOutputPath: '/project/proposal.md',
    existingOutputPaths: [],
    instruction: 'write proposal',
    template: '# Proposal',
    dependencies: [],
  };
  const apply = {
    changeName: 'add-auth',
    schemaName: 'spec-driven',
    contextFiles: {},
    progress: { total: 0, complete: 0, remaining: 0 },
    tasks: [],
    state: 'blocked',
    missingArtifacts: ['tasks'],
    instruction: 'blocked',
    context: 'Use project conventions.',
    operationGuidance: ['Run focused tests.'],
  };
  const archive = {
    changeName: 'add-auth',
    context: 'Use project conventions.',
    operationGuidance: ['Keep summaries concise.'],
    root: { path: '/project', source: 'nearest' },
  };

  assert.equal(assertInstructionsContract(artifact), artifact);
  assert.equal(assertInstructionsContract(apply), apply);
  assert.equal(assertArchiveInstructionsContract(archive), archive);
  assert.throws(
    () => assertInstructionsContract({ ...apply, contextFiles: [] }),
    (error) => error.code === 3
  );
});
