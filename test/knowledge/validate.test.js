import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { validateKnowledge, fingerprintEntry } from '../../src/knowledge/validate.js';
import { main } from '../../src/cli.js';

const ENTRY = '.falla/ui-knowledge/components/retry-list.md';
const SOURCE = 'app/src/main/java/RetryList.kt';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-knowledge-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, path.dirname(ENTRY)), { recursive: true });
  await mkdir(path.join(root, path.dirname(SOURCE)), { recursive: true });
  await mkdir(path.join(root, 'openspec'));
  await writeFile(path.join(root, SOURCE), 'class RetryList\n');
  return root;
}

function metadata(overrides = {}) {
  return {
    'schema-version': 1, id: 'retry-list', kind: 'component', scope: 'project',
    status: 'draft', platform: 'android-view', aliases: [], intents: [], tags: [],
    codegraph: { 'primary-symbol': 'RetryList', 'related-symbols': [] },
    'source-files': [SOURCE], 'layout-resources': [], tests: [],
    'source-hashes': {}, 'last-verified': null, 'verified-by': '', ...overrides,
  };
}

async function writeEntry(root, overrides = {}, relative = ENTRY) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  const text = `---\n${YAML.stringify(metadata(overrides))}---\n# 重试列表\n\n## 状态、交互与生命周期\n\n由 Fragment View 持有，onDestroyView 取消订阅。\n`;
  await writeFile(path.join(root, relative), text);
  return text;
}

test('缺少知识目录时返回空报告且不创建目录', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, '.falla'), { recursive: true });
  const report = await validateKnowledge(root);
  assert.equal(report.ok, true);
  assert.equal(report.entries.length, 0);
  await assert.rejects(readFile(path.join(root, '.falla/ui-knowledge/config.yaml')), { code: 'ENOENT' });
});

test('draft 仅可参考，verified 在源码指纹匹配后可成为直接复用候选', async (t) => {
  const root = await fixture(t);
  await writeEntry(root);
  assert.equal((await validateKnowledge(root)).entries[0].reuse, 'reference-only');
  const before = await readFile(path.join(root, ENTRY), 'utf8');
  const result = await fingerprintEntry(root, ENTRY);
  assert.deepEqual(result.sourceHashes, { [SOURCE]: createHash('sha256').update('class RetryList\n').digest('hex') });
  assert.equal(await readFile(path.join(root, ENTRY), 'utf8'), before);
  await writeEntry(root, { status: 'verified', 'last-verified': '2026-01-01', 'verified-by': 'reviewer-a', 'source-hashes': result.sourceHashes });
  const report = await validateKnowledge(root);
  assert.equal(report.ok, true);
  assert.equal(report.entries[0].reuse, 'direct-reuse-candidate');
});

test('源码变化令 verified 过期，只读校验不自动改写状态', async (t) => {
  const root = await fixture(t);
  await writeEntry(root);
  const hashes = (await fingerprintEntry(root, ENTRY)).sourceHashes;
  const text = await writeEntry(root, { status: 'verified', 'last-verified': '2026-01-01', 'verified-by': 'reviewer-a', 'source-hashes': hashes });
  await writeFile(path.join(root, SOURCE), 'class RetryList { fun changed() {} }');
  const report = await validateKnowledge(root);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(e => e.kind === 'stale-evidence'));
  assert.equal(report.entries[0].reuse, 'rejected');
  assert.equal(await readFile(path.join(root, ENTRY), 'utf8'), text);
});

test('verified 缺少 reviewer、验证日期和指纹时拒绝直接复用', async (t) => {
  const root = await fixture(t);
  await writeEntry(root, { status: 'verified' });
  const report = await validateKnowledge(root);
  for (const kind of ['reviewer-required', 'verification-date-required', 'evidence-hash-required']) {
    assert.ok(report.errors.some(e => e.kind === kind), kind);
  }
});

test('verified 的非法 CodeGraph 绑定保留字段诊断', async (t) => {
  const root = await fixture(t);
  await writeEntry(root, {
    status: 'verified', codegraph: { 'primary-symbol': 42, 'related-symbols': [] },
  });
  const report = await validateKnowledge(root);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(e => e.kind === 'invalid-codegraph-binding'));
  assert.ok(report.errors.some(e => e.kind === 'primary-symbol-required'));
  assert.ok(report.errors.every(e => e.kind !== 'unreadable-entry'));
});

test('拒绝非 Android 平台、非法 schema/scope 和项目内重复 ID', async (t) => {
  const root = await fixture(t);
  await writeEntry(root, { platform: 'ios', scope: 'organization', 'schema-version': 999 });
  await writeEntry(root, {}, '.falla/ui-knowledge/components/another.md');
  const report = await validateKnowledge(root);
  for (const kind of ['invalid-platform', 'invalid-schema-version', 'invalid-scope', 'duplicate-id']) {
    assert.ok(report.errors.some(e => e.kind === kind), kind);
  }
  assert.ok(report.entries.every(e => e.reuse === 'rejected'));
});

test('拒绝项目外证据、敏感路径和符号链接且不回显其内容', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'local.properties'), 'API_KEY=PRIVATE_MARKER');
  for (const source of ['../outside.kt', '/Users/private/secret.kt', 'local.properties', '.git/config']) {
    await writeEntry(root, { 'source-files': [source] });
    const report = await validateKnowledge(root);
    assert.equal(report.ok, false, source);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_MARKER|Users\/private|outside.kt/);
    await assert.rejects(fingerprintEntry(root, ENTRY));
  }
  await symlink(path.join(root, 'local.properties'), path.join(root, 'linked.kt'));
  await writeEntry(root, { 'source-files': ['linked.kt'] });
  assert.equal((await validateKnowledge(root)).ok, false);
});

test('知识目录本身是链接时拒绝跟随', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, '.falla/ui-knowledge/components'), { recursive: true });
  await symlink(path.join(root, 'app'), path.join(root, '.falla/ui-knowledge/components'));
  const report = await validateKnowledge(root);
  assert.equal(report.ok, false);
  assert.equal(report.entries.length, 0);
});

test('超大条目及超大源码拒绝读取，未来日期不能证明已验证', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, ENTRY), 'x'.repeat(256 * 1024 + 1));
  assert.equal((await validateKnowledge(root)).ok, false);
  await writeEntry(root, { status: 'verified', 'last-verified': '2999-01-01', 'verified-by': 'reviewer-a' });
  assert.ok((await validateKnowledge(root)).errors.some(e => e.kind === 'invalid-verification-date'));
  await writeFile(path.join(root, SOURCE), 'x'.repeat(4 * 1024 * 1024 + 1));
  await assert.rejects(fingerprintEntry(root, ENTRY));
});

test('invalid/deprecated 状态不成为复用候选且不要求修复历史指纹', async (t) => {
  const root = await fixture(t);
  await writeEntry(root, { status: 'invalid', 'source-files': ['missing.kt'] });
  const report = await validateKnowledge(root);
  assert.equal(report.ok, true);
  assert.equal(report.entries[0].reuse, 'rejected');
  assert.ok(report.warnings.length > 0);
});

test('UI CLI 返回校验退出码与只读指纹，错误不包含正文', async (t) => {
  const root = await fixture(t);
  await writeEntry(root);
  let output = '';
  const io = { cwd: root, stdout: { write: text => { output += text; } } };
  assert.equal(await main(['ui-knowledge', 'validate', '--json'], io), 0);
  assert.equal(JSON.parse(output).entries.length, 1);
  output = '';
  assert.equal(await main(['ui-knowledge', 'fingerprint', ENTRY, '--json'], io), 0);
  assert.equal(Object.keys(JSON.parse(output).sourceHashes).length, 1);
  await writeEntry(root, { platform: 'flutter' });
  output = '';
  assert.equal(await main(['ui-knowledge', 'validate', '--json'], io), 1);
});
