import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { inspectCodeGraph } from '../../src/ui/codegraph.js';
import { prepareCodeGraph } from '../../templates/hooks/falla-codegraph.mjs';
import { main } from '../../src/cli.js';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-graph-health-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'bin'));
  await mkdir(path.join(root, 'openspec'));
  await mkdir(path.join(root, '.falla'));
  await writeFile(path.join(root, '.falla/install-manifest.json'), JSON.stringify({ formatVersion: 3, integrations: { codegraph: true } }));
  const binary = path.join(root, 'bin/codegraph');
  await writeFile(binary, '#!/bin/sh\nprintf "%s|%s\\n" "$*" "${OPENAI_API_KEY-unset}" >> calls.log\nexit 0\n');
  await chmod(binary, 0o755);
  return { root, env: { PATH: path.join(root, 'bin'), OPENAI_API_KEY: 'PRIVATE_GRAPH_TOKEN' } };
}

test('CodeGraph 未启用不执行，缺失 CLI/索引均报告不可用', async (t) => {
  const { root } = await fixture(t);
  const disabled = await inspectCodeGraph(root, { enabled: false, env: { PATH: '' } });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.state, 'disabled');
  const missing = await inspectCodeGraph(root, { enabled: true, env: { PATH: '' } });
  assert.equal(missing.ok, false);
  assert.equal(missing.available, false);
  assert.equal(missing.indexPresent, false);
});

test('探测只确认 CLI 和索引文件存在，不宣称索引新鲜或 MCP 已连接', async (t) => {
  const { root, env } = await fixture(t);
  await mkdir(path.join(root, '.codegraph'));
  await writeFile(path.join(root, '.codegraph/codegraph.db'), 'fixture');
  const result = await inspectCodeGraph(root, { enabled: true, env });
  assert.equal(result.ok, true);
  assert.equal(result.freshness, 'not-checked');
  assert.equal(result.connection, 'not-checked');
  assert.equal(await readFile(path.join(root, 'calls.log'), 'utf8'), '--version|unset\n');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_GRAPH_TOKEN/);
});

test('CodeGraph 索引链接不能算作可用索引', async (t) => {
  const { root, env } = await fixture(t);
  await symlink(path.join(root, 'bin'), path.join(root, '.codegraph'));
  assert.equal((await inspectCodeGraph(root, { enabled: true, env })).ok, false);
});

test('显式 prepare 每次执行且失败不缓存，CLI 返回脱敏失败状态', async (t) => {
  const { root, env } = await fixture(t);
  assert.equal((await prepareCodeGraph(root, { env })).ready, true);
  assert.equal((await prepareCodeGraph(root, { env })).ready, true);
  assert.equal((await readFile(path.join(root, 'calls.log'), 'utf8')).split('\n').filter(Boolean).length, 2);
  await writeFile(path.join(root, 'bin/codegraph'), '#!/bin/sh\necho PRIVATE_ERROR >&2\nexit 9\n');
  let output = '';
  assert.equal(await main(['codegraph', 'prepare', '--json'], { cwd: root, env, stdout: { write: value => { output += value; } } }), 1);
  assert.equal(JSON.parse(output).ready, false);
  assert.doesNotMatch(output, /PRIVATE_ERROR|PRIVATE_GRAPH_TOKEN/);
});
