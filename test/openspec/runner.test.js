import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runOpenSpec, runOpenSpecJson } from '../../src/openspec/runner.js';

async function fixtureScript(source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'falla-openspec-runner-'));
  const file = path.join(directory, 'fixture.mjs');
  await writeFile(file, source, 'utf8');
  return { directory, file };
}

test('用参数数组执行命令并保留工作目录', async () => {
  const fixture = await fixtureScript(
    "console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\n"
  );

  const result = await runOpenSpec([fixture.file, 'status', '--json'], {
    cwd: fixture.directory,
    executable: process.execPath,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ['status', '--json'],
    cwd: await realpath(fixture.directory),
  });
});

test('外部命令失败时不泄露 stderr 正文或参数', async () => {
  const fixture = await fixtureScript(
    "console.error('SECRET_VALUE'); process.exitCode = 7;\n"
  );

  await assert.rejects(
    () => runOpenSpec([fixture.file, 'SECRET_ARGUMENT'], {
      cwd: fixture.directory,
      executable: process.execPath,
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.doesNotMatch(error.message, /SECRET_VALUE|SECRET_ARGUMENT/);
      assert.equal(error.details.exitCode, 7);
      return true;
    }
  );
});

test('JSON 输出异常时不回显原始正文', async () => {
  const fixture = await fixtureScript("console.log('SENSITIVE_NOT_JSON');\n");

  await assert.rejects(
    () => runOpenSpecJson([fixture.file], {
      cwd: fixture.directory,
      executable: process.execPath,
    }),
    (error) => error.code === 3 && !error.message.includes('SENSITIVE_NOT_JSON')
  );
});
