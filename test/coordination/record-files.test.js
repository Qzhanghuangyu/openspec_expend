import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { assertRecordDirectory, MAX_RECORD_BYTES, readChangeRecordFile } from '../../src/coordination/record-files.js';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-record-files-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'openspec/changes/page');
  await mkdir(directory, { recursive: true });
  return { root, directory };
}

test('记录读取在预算边界返回全文，超限拒绝，缺失保持可选契约且不能跨父目录', async t => {
  const p = await fixture(t);
  const file = path.join(p.directory, 'comate.md');
  const text = 'a'.repeat(MAX_RECORD_BYTES);
  await writeFile(file, text);
  assert.equal(await readChangeRecordFile(p.root, p.directory, 'comate.md'), text);
  await writeFile(file, text + 'a');
  await assert.rejects(() => readChangeRecordFile(p.root, p.directory, 'comate.md'), /256 KiB/);
  assert.equal(await readChangeRecordFile(p.root, p.directory, 'missing.md', true), null);
  await assert.rejects(() => readChangeRecordFile(p.root, p.directory, '../comate.md'), /文件名/);
  await assert.rejects(() => assertRecordDirectory(p.root, path.dirname(p.root)), /项目边界/);
});

test('根别名可以规范化，但根内目录链接和最终记录链接都不能读取', async t => {
  const p = await fixture(t);
  const alias = path.join(p.root, 'root-alias');
  await symlink(p.root, alias);
  const file = path.join(p.directory, 'comate.md');
  await writeFile(file, '真实记录\n');
  assert.equal(await readChangeRecordFile(alias, path.join(alias, 'openspec/changes/page'), 'comate.md'), '真实记录\n');
  const folderAlias = path.join(p.root, 'openspec/changes/linked');
  await symlink(p.directory, folderAlias);
  await assert.rejects(() => readChangeRecordFile(p.root, folderAlias, 'comate.md'), /符号链接/);
  await symlink(file, path.join(p.directory, 'tasks.md'));
  await assert.rejects(() => readChangeRecordFile(p.root, p.directory, 'tasks.md'), /符号链接/);
});

test('FIFO 记录不会挂起读取，失败路径不创建文件或保留描述符', async t => {
  const p = await fixture(t);
  const execute = promisify(execFile);
  const file = path.join(p.directory, 'tasks.md');
  await execute('mkfifo', [file], { timeout: 5000 });
  await assert.rejects(() => readChangeRecordFile(p.root, p.directory, 'tasks.md'), /普通文件/);
  assert.deepEqual(await readdir(p.directory), ['tasks.md']);
});

test('重复正常读取不遗留打开的句柄，临时目录只包含原始文件', async t => {
  const p = await fixture(t);
  const file = path.join(p.directory, 'comate.md');
  await writeFile(file, '完成证据\n');
  for (let index = 0; index < 50; index += 1) {
    assert.equal(await readChangeRecordFile(p.root, p.directory, 'comate.md'), '完成证据\n');
  }
  assert.equal(await readFile(file, 'utf8'), '完成证据\n');
  assert.deepEqual(await readdir(p.directory), ['comate.md']);
});
