import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readText = (path) => readFile(path, 'utf8');

test('初始化与更新手册随包分发并由 README 入口引用', async () => {
  const packageDocument = JSON.parse(await readText('package.json'));
  const readme = await readText('README.md');

  assert.ok(packageDocument.files.includes('docs'));
  assert.match(readme, /docs\/installation-and-update\.md/);
});

test('手册覆盖初始化、幂等更新、工具选择和安全失败处理', async () => {
  const manual = await readText('docs/installation-and-update.md');

  assert.match(manual, /openspec init --tools none/);
  assert.match(manual, /cat "\$HOME\/android\/androidCopy\/\.falla\/install-manifest\.json"/);
  assert.match(manual, /node "\$HOME\/android\/workflow\/falla-openspec\/bin\/falla-openspec\.js" install "\$HOME\/android\/androidCopy" --tools claude,codex --non-interactive/);
  assert.match(manual, /node "\$HOME\/android\/workflow\/falla-openspec\/bin\/falla-openspec\.js" doctor "\$HOME\/android\/androidCopy" --json/);
  assert.match(manual, /install-mainfest\.json/);
  assert.match(manual, /falla-openspec install/);
  assert.match(manual, /重复执行 install 完成更新/);
  assert.match(manual, /\.falla\/install-manifest\.json/);
  assert.match(manual, /更新时必须传入相同的 `--tools`/);
  assert.match(manual, /不要重复传 `--with-figma` 或 `--with-lark`/);
  assert.match(manual, /falla-openspec doctor/);
  assert.match(manual, /重新创建 Claude Code\/Codex 会话/);
  assert.match(manual, /安装器没有 `--force`/);
  assert.match(manual, /不要通过删除 `\.falla\/install-manifest\.json`/);
});
