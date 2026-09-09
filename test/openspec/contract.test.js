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
    changeRoot: '/project/openspec/changes/add-auth',
    isPlanningComplete: false,
    isComplete: false,
    artifacts: [{
      id: 'proposal', outputPath: 'proposal.md', status: 'ready', requires: [],
    }],
    artifactPaths: {
      proposal: {
        outputPath: 'proposal.md',
        resolvedOutputPath: '/project/openspec/changes/add-auth/proposal.md',
        existingOutputPaths: [],
      },
    },
    nextSteps: ['Create proposal'],
    actionContext: { canApply: false },
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
    changeRoot: '/project/openspec/changes/add-auth',
    isPlanningComplete: true,
    isComplete: true,
    artifacts: [{
      id: 'specs', outputPath: 'specs/**/*.md', status: 'skipped', requires: ['proposal'],
    }],
    artifactPaths: {
      specs: {
        outputPath: 'specs/**/*.md',
        resolvedOutputPath: '/project/openspec/changes/add-auth/specs/**/*.md',
        existingOutputPaths: [],
      },
    },
    nextSteps: ['Apply change'],
    actionContext: { canApply: true },
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

test('status 契约拒绝 artifactPaths 中的非字符串路径', () => {
  const value = {
    changeName: 'add-auth',
    schemaName: 'spec-driven',
    changeRoot: '/project/openspec/changes/add-auth',
    isPlanningComplete: false,
    isComplete: false,
    artifacts: [{
      id: 'proposal', outputPath: 'proposal.md', status: 'ready', requires: [],
    }],
    artifactPaths: {
      proposal: {
        outputPath: 'proposal.md',
        resolvedOutputPath: '/project/openspec/changes/add-auth/proposal.md',
        existingOutputPaths: [42],
      },
    },
    nextSteps: [],
    actionContext: {},
    applyRequires: ['tasks'],
  };

  assert.throws(
    () => assertStatusContract(value),
    (error) => error.code === 3
      && error.details.field === 'status.artifactPaths.proposal.existingOutputPaths[0]'
  );
});

test('instructions 契约拒绝错误的 contextFiles、dependency 和 task 成员', () => {
  const artifact = {
    changeName: 'add-auth',
    artifactId: 'tasks',
    schemaName: 'spec-driven',
    outputPath: 'tasks.md',
    resolvedOutputPath: '/project/tasks.md',
    existingOutputPaths: [],
    instruction: 'write tasks',
    template: '# Tasks',
    dependencies: [{
      id: 'proposal', done: 'yes', path: 'proposal.md', description: 'Proposal',
    }],
  };
  const apply = {
    changeName: 'add-auth',
    schemaName: 'spec-driven',
    contextFiles: { tasks: [42] },
    progress: { total: 1, complete: 0, remaining: 1 },
    tasks: [{ id: '1.1', description: 'work', done: 'no' }],
    state: 'ready',
    instruction: 'apply',
  };

  assert.throws(
    () => assertInstructionsContract(artifact),
    (error) => error.code === 3 && error.details.field === 'instructions.dependencies[0].done'
  );
  assert.throws(
    () => assertInstructionsContract(apply),
    (error) => error.code === 3 && error.details.field === 'instructions.contextFiles.tasks[0]'
  );
  assert.throws(
    () => assertInstructionsContract({ ...apply, contextFiles: { tasks: ['/project/tasks.md'] } }),
    (error) => error.code === 3 && error.details.field === 'instructions.tasks[0].done'
  );
});
