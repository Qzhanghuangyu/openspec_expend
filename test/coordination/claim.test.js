import { writeTestBaseline } from '../helpers/baseline.js';
import { writeReviewedPreflight } from '../helpers/preflight.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claimChange } from '../../src/coordination/claim.js';
import { registerMapping } from '../../src/coordination/resolver.js';

async function createProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-coordination-claim-'));
  await mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });
  return root;
}

function officialStatus(changeName, schemaName = 'falla-spec-driven', planningComplete = true) {
  return {
    changeName,
    schemaName,
    changeRoot: `/untrusted/${changeName}`,
    isPlanningComplete: planningComplete,
    isComplete: planningComplete,
    artifacts: [{
      id: 'comate', outputPath: 'comate.md', status: planningComplete ? 'done' : 'waiting',
      requires: ['tasks'],
    }],
    artifactPaths: {
      comate: {
        outputPath: 'comate.md',
        resolvedOutputPath: `/untrusted/${changeName}/comate.md`,
        existingOutputPaths: [],
      },
    },
    applyRequires: ['comate'],
    nextSteps: [],
    actionContext: {},
  };
}

function comate({
  mode = 'single',
  owner = 'unassigned',
  status = 'todo',
  dependsOn = [],
  handoff = 'SENSITIVE_HANDOFF_BODY',
} = {}) {
  return `# comate

${mode ? `- 执行模式 (execution-mode): ${mode}\n` : ''}- 负责人 (owner): ${owner}
- 状态 (status): ${status}
- 依赖 (depends-on): [${dependsOn.join(', ')}]
- 被依赖 (blocks): []
- 交接 (handoff):
  - 已完成：${handoff}
- 自定义顶级字段: 保留此内容
`;
}

async function writeRecord(root, physical, record = comate()) {
  const directory = path.join(root, 'openspec', 'changes', physical);
  await mkdir(directory, { recursive: true });
  await writeReviewedPreflight(directory);
  await writeFile(path.join(directory, 'comate.md'), record, 'utf8');
  await writeFile(path.join(directory, 'tasks.md'), '- [ ] 1.1 pending\n', 'utf8');
  return directory;
}

test('single 父 change 认领后只更新 owner/status 并返回脱敏结果', async () => {
  const root = await createProject();
  const directory = await writeRecord(root, 'solo');

  const result = await claimChange(root, 'solo', {
    owner: 'SECRET_OWNER',
    statusProvider: async (physical) => {
      if (physical !== 'solo') throw new Error('unexpected change');
      return officialStatus('solo');
    },
  });

  assert.deepEqual(result, {
    change: 'solo', status: 'in-progress', claimed: true, idempotent: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /SECRET_OWNER|SENSITIVE_HANDOFF_BODY/);
  const updated = await readFile(path.join(directory, 'comate.md'), 'utf8');
  assert.match(updated, /- 负责人 \(owner\): SECRET_OWNER/);
  assert.match(updated, /- 状态 \(status\): in-progress/);
  assert.match(updated, /SENSITIVE_HANDOFF_BODY/);
  assert.match(updated, /自定义顶级字段: 保留此内容/);
});

test('同 owner 的 in-progress 重试幂等，其他 owner 不可抢占', async () => {
  const root = await createProject();
  const initial = comate({ owner: 'alice', status: 'in-progress' });
  const directory = await writeRecord(root, 'solo', initial);
  await writeTestBaseline(root, 'solo');
  const verifiedInitial = await readFile(path.join(directory, 'comate.md'), 'utf8');
  const options = { owner: 'alice', statusProvider: async () => officialStatus('solo') };

  assert.deepEqual(await claimChange(root, 'solo', options), {
    change: 'solo', status: 'in-progress', claimed: false, idempotent: true,
  });
  assert.equal(await readFile(path.join(directory, 'comate.md'), 'utf8'), verifiedInitial);
  await assert.rejects(
    () => claimChange(root, 'solo', { ...options, owner: 'bob' }),
    (error) => error.code === 1 && error.message.includes('不可抢占')
      && !error.message.includes('alice')
  );
});

test('认领拒绝规划未完成、blocked、done、archived 和未完成依赖', async () => {
  for (const [name, record, planningComplete, expected] of [
    ['planning', comate(), false, '规划'],
    ['blocked', comate({ owner: 'alice', status: 'blocked' }), true, 'blocked'],
    ['done', comate({ owner: 'alice', status: 'done' }), true, 'done'],
  ]) {
    const root = await createProject();
    await writeRecord(root, name, record);
    await assert.rejects(
      () => claimChange(root, name, {
        owner: 'bob', statusProvider: async () => officialStatus(name, 'falla-spec-driven', planningComplete),
      }),
      (error) => error.code === 1 && error.message.includes(expected)
    );
  }

  const dependencyRoot = await createProject();
  await writeRecord(dependencyRoot, 'foundation', comate({ owner: 'alice', status: 'in-progress' }));
  await writeRecord(dependencyRoot, 'solo', comate({ dependsOn: ['foundation'] }));
  await assert.rejects(
    () => claimChange(dependencyRoot, 'solo', {
      owner: 'bob', statusProvider: async () => officialStatus('solo'),
    }),
    (error) => error.code === 1 && error.message.includes('依赖')
  );

  const archivedRoot = await createProject();
  const active = await writeRecord(archivedRoot, 'archived');
  const archive = path.join(archivedRoot, 'openspec', 'changes', 'archive', '2026-09-15-archived');
  await mkdir(path.dirname(archive), { recursive: true });
  await import('node:fs/promises').then(({ rename }) => rename(active, archive));
  await assert.rejects(
    () => claimChange(archivedRoot, 'archived', {
      owner: 'bob', statusProvider: async () => officialStatus('archived'),
    }),
    (error) => error.code === 1 && error.message.includes('归档')
  );
});

test('parallel 逻辑子 change 在依赖完成后可认领', async () => {
  const root = await createProject();
  await writeRecord(root, 'medal', comate({ mode: 'parallel' }));
  await writeRecord(root, 'foundation', comate({
    owner: 'alice', status: 'done', handoff: 'verified',
  }));
  await writeFile(path.join(root, 'openspec/changes/foundation/tasks.md'), '- [x] 1.1 verified\n');
  const mapping = await registerMapping(root, 'medal/card');
  await writeRecord(root, mapping.physical, comate({ mode: null, dependsOn: ['foundation'] }));

  await writeTestBaseline(root, 'foundation');
  await claimChange(root, 'medal', {
    owner: 'coordinator', coordinator: true,
    statusProvider: async physical => officialStatus(physical, physical === mapping.physical ? 'falla-task-driven' : 'falla-spec-driven'),
  });
  const result = await claimChange(root, 'medal/card', {
    owner: 'bob',
    statusProvider: async (physical) => officialStatus(physical, physical === mapping.physical ? 'falla-task-driven' : 'falla-spec-driven'),
  });

  assert.deepEqual(result, {
    change: 'medal/card', status: 'in-progress', claimed: true, idempotent: false,
  });
});

test('并发不同 owner 通过同一真实项目锁时只有一方成功', async () => {
  const root = await createProject();
  await writeRecord(root, 'solo');
  const aliasRoot = `${root}-alias`;
  await symlink(root, aliasRoot);
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const first = claimChange(root, 'solo', {
    owner: 'alice',
    statusProvider: async () => {
      entered();
      await gate;
      return officialStatus('solo');
    },
  });
  await enteredPromise;
  const second = claimChange(aliasRoot, 'solo', {
    owner: 'bob', statusProvider: async () => officialStatus('solo'),
  });
  release();

  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
});

test('owner 在加锁前限制长度和字符，comate 符号链接不可读取', async () => {
  const root = await createProject();
  await writeRecord(root, 'solo');
  for (const owner of ['bad owner', 'a'.repeat(65), 'unassigned']) {
    await assert.rejects(
      () => claimChange(root, 'solo', {
        owner, statusProvider: async () => officialStatus('solo'),
      }),
      (error) => error.code === 1 && error.message.includes('owner')
    );
  }

  const linkedRoot = await createProject();
  const directory = await writeRecord(linkedRoot, 'linked');
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'falla-claim-outside-')), 'comate.md');
  await writeFile(outside, comate(), 'utf8');
  await import('node:fs/promises').then(({ unlink }) => unlink(path.join(directory, 'comate.md')));
  await symlink(outside, path.join(directory, 'comate.md'));
  await assert.rejects(
    () => claimChange(linkedRoot, 'linked', {
      owner: 'alice', statusProvider: async () => officialStatus('linked'),
    }),
    (error) => error.code === 1 && error.message.includes('符号链接')
  );
});

test('依赖只把 status 改为 done 但任务未完成时不可认领', async () => {
  const root = await createProject();
  await writeRecord(root, 'foundation', comate({ owner: 'alice', status: 'done' }));
  await writeRecord(root, 'solo', comate({ dependsOn: ['foundation'] }));
  await assert.rejects(claimChange(root, 'solo', {
    owner: 'bob', statusProvider: async physical => officialStatus(physical),
  }), /依赖/);
});

test('同 owner 重试也重新检查退回未完成的上游', async () => {
  const root = await createProject();
  await writeRecord(root, 'foundation', comate({ owner: 'alice', status: 'in-progress' }));
  await writeRecord(root, 'solo', comate({ owner: 'bob', status: 'in-progress', dependsOn: ['foundation'] }));
  await assert.rejects(claimChange(root, 'solo', {
    owner: 'bob', statusProvider: async physical => officialStatus(physical),
  }), /依赖/);
});

test('旧父记录缺少模式但已有子映射时不能作为 single 认领', async () => {
  const root = await createProject();
  await writeRecord(root, 'medal', comate({ mode: null }));
  await registerMapping(root, 'medal/card');
  await assert.rejects(claimChange(root, 'medal', {
    owner: 'bob', statusProvider: async physical => officialStatus(physical),
  }), /parallel|子 change/);
});

test('子 change 规划完成但父规划未完成时不能提前认领', async () => {
  const root = await createProject();
  await writeRecord(root, 'medal', comate({ mode: 'parallel' }));
  const mapping = await registerMapping(root, 'medal/card');
  await writeRecord(root, mapping.physical, comate({ mode: null }));
  await assert.rejects(claimChange(root, 'medal/card', {
    owner: 'bob', statusProvider: async physical => physical === 'medal'
      ? officialStatus('medal', 'falla-spec-driven', false) : officialStatus(physical, 'falla-task-driven'),
  }), /父.*规划/);
});

async function pendingParallelProject() {
  const root = await createProject();
  const parent = await writeRecord(root, 'team', comate({ mode: 'parallel' }));
  const mapping = await registerMapping(root, 'team/worker');
  const child = await writeRecord(root, mapping.physical, comate({ mode: null }));
  const statusProvider = async physical => officialStatus(physical,
    physical === mapping.physical ? 'falla-task-driven' : 'falla-spec-driven');
  return { root, parent, child, statusProvider };
}

test('默认 parallel 父通过显式协调认领获得责任，子 owner/status 不被改写', async () => {
  const { root, parent, child, statusProvider } = await pendingParallelProject();
  const beforeChild = await readFile(path.join(child, 'comate.md'), 'utf8');
  const result = await claimChange(root, 'team', {
    owner: 'SECRET_COORDINATOR', coordinator: true, statusProvider,
  });
  assert.deepEqual(result, {
    change: 'team', role: 'coordinator', status: 'in-progress', claimed: true, idempotent: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /SECRET_COORDINATOR|SENSITIVE_HANDOFF_BODY/);
  assert.match(await readFile(path.join(parent, 'comate.md'), 'utf8'), /owner\): SECRET_COORDINATOR/);
  assert.equal(await readFile(path.join(child, 'comate.md'), 'utf8'), beforeChild);
  assert.deepEqual(await claimChange(root, 'team', {
    owner: 'SECRET_COORDINATOR', coordinator: true, statusProvider,
  }), { ...result, claimed: false, idempotent: true });
});

test('父协调者未就位时子认领失败且父子均不写部分状态', async () => {
  const { root, parent, child, statusProvider } = await pendingParallelProject();
  const beforeParent = await readFile(path.join(parent, 'comate.md'), 'utf8');
  const beforeChild = await readFile(path.join(child, 'comate.md'), 'utf8');
  await assert.rejects(claimChange(root, 'team/worker', { owner: 'worker', statusProvider }), /父协调者/);
  assert.equal(await readFile(path.join(parent, 'comate.md'), 'utf8'), beforeParent);
  assert.equal(await readFile(path.join(child, 'comate.md'), 'utf8'), beforeChild);
});

test('协调认领标志不能用于 single 或逻辑子，也不能隐式授予子实施权', async () => {
  const soloRoot = await createProject();
  const solo = await writeRecord(soloRoot, 'solo');
  const soloBefore = await readFile(path.join(solo, 'comate.md'), 'utf8');
  await assert.rejects(claimChange(soloRoot, 'solo', {
    owner: 'alice', coordinator: true, statusProvider: async physical => officialStatus(physical),
  }), /协调|parallel/);
  assert.equal(await readFile(path.join(solo, 'comate.md'), 'utf8'), soloBefore);
  const { root, child, statusProvider } = await pendingParallelProject();
  const before = await readFile(path.join(child, 'comate.md'), 'utf8');
  await assert.rejects(claimChange(root, 'team/worker', {
    owner: 'alice', coordinator: true, statusProvider,
  }), /协调|parallel/);
  assert.equal(await readFile(path.join(child, 'comate.md'), 'utf8'), before);
});

test('parallel 父协调认领并发不同 owner 只成功一方，子保持默认未认领', async () => {
  const { root, parent, child, statusProvider } = await pendingParallelProject();
  const beforeChild = await readFile(path.join(child, 'comate.md'), 'utf8');
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const first = claimChange(root, 'team', {
    owner: 'leader-a', coordinator: true,
    statusProvider: async physical => { entered(); await gate; return statusProvider(physical); },
  });
  try {
    await started;
    await assert.rejects(claimChange(root, 'team', {
      owner: 'leader-b', coordinator: true, statusProvider,
    }), /正在进行/);
  } finally { release(); }
  await first;
  await assert.rejects(claimChange(root, 'team', {
    owner: 'leader-b', coordinator: true, statusProvider,
  }), /不可抢占/);
  assert.match(await readFile(path.join(parent, 'comate.md'), 'utf8'), /owner\): leader-a/);
  assert.equal(await readFile(path.join(child, 'comate.md'), 'utf8'), beforeChild);
});

test('父协调认领后的 owner/status 会使记录超限时须落盘前拒绝，原父子文件不变', async () => {
  const { root, parent, child, statusProvider } = await pendingParallelProject();
  await writeTestBaseline(root, 'team');
  const file = path.join(parent, 'comate.md');
  const current = await readFile(file, 'utf8');
  await writeFile(file, current + ' '.repeat(256 * 1024 - Buffer.byteLength(current)));
  const before = await readFile(file, 'utf8');
  const beforeChild = await readFile(path.join(child, 'comate.md'), 'utf8');
  await assert.rejects(claimChange(root, 'team', {
    owner: 'x'.repeat(64), coordinator: true, statusProvider,
  }), /无效|限制|过大/);
  assert.ok(await readFile(file, 'utf8') === before, '超限认领必须保留原父记录，不先写 owner/status');
  assert.equal(await readFile(path.join(child, 'comate.md'), 'utf8'), beforeChild);
});
