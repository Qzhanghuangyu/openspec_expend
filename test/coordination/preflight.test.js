import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { validatePreflight } from '../../src/coordination/preflight.js';

const header = 'falla-preflight: 1\nreviewed: true\n';
const entry = '  - id: B1\n    scope: PRIVATE_SCOPE\n    status: confirmed\n    decision: PRIVATE_DECISION\n    evidence: PRIVATE_EVIDENCE\n';
const wrap = yaml => `---\n${yaml}---\n# Preflight\n`;

test('拒绝重复编号、结构错误、无效标签/别名与预算超限，错误不输出正文', () => {
  for (const yaml of [
    header + 'blockers:\n' + entry + entry,
    header + 'blockers:\n' + entry.replace('B1', 'PRIVATE_ID'),
    header + 'blockers:\n' + entry.replace('scope: PRIVATE_SCOPE', 'scope: []'),
    header + 'blockers:\n' + entry.replace('evidence: PRIVATE_EVIDENCE', 'evidence: null'),
    header + 'blockers: !PRIVATE_TAG []\n',
    header + 'blockers: &items []\nother: *items\n',
    header + 'blockers:\n' + Array.from({ length: 257 }, (_, i) => entry.replace('B1', `B${i + 1}`)).join(''),
    header + 'blockers: []\n' + ' '.repeat(256 * 1024),
  ]) {
    const errors = validatePreflight(wrap(yaml));
    assert.ok(errors.length > 0);
    assert.doesNotMatch(JSON.stringify(errors), /PRIVATE/);
  }
});

test('空模板必须核对才可放行，确认依据仅检查存在，不伪称能够核实真实性', async () => {
  const template = await readFile('templates/openspec/schemas/falla-spec-driven/templates/preflight.md', 'utf8');
  assert.ok(validatePreflight(template).some(error => error.kind === 'preflight-unverified'));
  assert.deepEqual(validatePreflight(wrap(header + 'blockers: []\n')), []);
  assert.deepEqual(validatePreflight(wrap(header + 'blockers:\n' + entry)), []);
});

test('多个未决项均报告规范编号，非空白的决定及依据才可关闭', () => {
  const errors = validatePreflight(wrap(header + 'blockers:\n'
    + entry.replace('status: confirmed', 'status: pending')
    + entry.replace('B1', 'B2').replace('evidence: PRIVATE_EVIDENCE', "evidence: '  '")));
  assert.deepEqual(errors, [
    { kind: 'preflight-blocker-unresolved', blocker: 'B1' },
    { kind: 'preflight-decision-evidence-required', blocker: 'B2' },
  ]);
});

test('YAML 转换集合键时不向子进程输出敏感正文，有效/无效/别名记录均保持静默', async () => {
  const execute = promisify(execFile);
  const collectionKey = '? [PRIVATE_BODY]\n: x\n';
  const inputs = [
    { yaml: header + 'blockers: []\n' + collectionKey, valid: true },
    { yaml: header + 'blockers: null\n' + collectionKey, valid: false },
    { yaml: header + 'blockers: &items []\n' + collectionKey + 'other: *items\n', valid: false },
    { yaml: header + 'blockers: !PRIVATE_TAG []\n', valid: false },
  ];
  for (const { yaml, valid } of inputs) {
    // 独立进程捕获异步 emitWarning；仅检查返回值或替换 console.warn 无法发现该输出路径。
    const script = `import { validatePreflight } from './src/coordination/preflight.js';
      process.stdout.write(JSON.stringify(validatePreflight(${JSON.stringify(wrap(yaml))})));`;
    const { stdout, stderr } = await execute(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(), timeout: 5000, maxBuffer: 64 * 1024,
      env: { ...process.env, NODE_OPTIONS: '', NODE_NO_WARNINGS: '0' },
    });
    assert.doesNotMatch(stdout + stderr, /PRIVATE/);
    assert.equal(stderr, '');
    assert.equal(JSON.parse(stdout).length === 0, valid);
  }
});
