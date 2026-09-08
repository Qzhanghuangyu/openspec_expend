import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import {
  loadCoordination,
  loadCoordinationSnapshot,
  saveCoordination,
} from '../../src/coordination/store.js';

test('缺少协调文件时返回空映射并可原子保存', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-coordination-store-'));
  const snapshot = await loadCoordinationSnapshot(root);
  assert.deepEqual(snapshot, {
    document: { version: 1, mappings: {} },
    hash: null,
  });

  const next = {
    version: 1,
    mappings: {
      'medal/detail': { physical: 'medal-child-detail', parent: 'medal' },
    },
  };
  await saveCoordination(root, next, { expectedHash: null });

  assert.deepEqual(await loadCoordination(root), next);
  assert.deepEqual(
    YAML.parse(await readFile(path.join(root, '.falla', 'coordination.yaml'), 'utf8')),
    next
  );
});

test('并发修改后拒绝覆盖协调文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-coordination-store-'));
  await mkdir(path.join(root, '.falla'), { recursive: true });
  const file = path.join(root, '.falla', 'coordination.yaml');
  await writeFile(file, 'version: 1\nmappings: {}\n', 'utf8');
  const snapshot = await loadCoordinationSnapshot(root);
  await writeFile(file, 'version: 1\nmappings:\n  manual: true\n', 'utf8');

  await assert.rejects(
    () => saveCoordination(root, snapshot.document, { expectedHash: snapshot.hash }),
    (error) => error.code === 1 && error.message.includes('并发修改')
  );
});

test('拒绝通过符号链接读取项目外协调文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-coordination-store-'));
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'falla-outside-')), 'data.yaml');
  await writeFile(outside, 'version: 1\nmappings: {}\n', 'utf8');
  await mkdir(path.join(root, '.falla'), { recursive: true });
  await symlink(outside, path.join(root, '.falla', 'coordination.yaml'));

  await assert.rejects(
    () => loadCoordination(root),
    (error) => error.code === 1 && error.message.includes('符号链接')
  );
});
