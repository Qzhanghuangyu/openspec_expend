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

test('安装手册只保留安装、更新、可选集成和排障', async () => {
  const manual = await readText('docs/installation-and-update.md');
  const first = manual.indexOf('## 第一次安装');
  const update = manual.indexOf('## 以后更新');
  const optional = manual.indexOf('## 需要外部工具时');
  const troubleshooting = manual.indexOf('## 出问题了');
  assert.ok(first >= 0 && first < update && update < optional && optional < troubleshooting);

  const quickStart = manual.slice(first, update);
  const upgrade = manual.slice(update, optional);
  for (const section of [quickStart, upgrade]) {
    assert.match(section, /export FALLA_HOME="\/path\/to\/falla-openspec"/);
    assert.match(section, /export TARGET_PROJECT="\/path\/to\/project"/);
    assert.match(section, /node bin\/falla-openspec\.js doctor "\$TARGET_PROJECT" --json/);
  }
  assert.match(quickStart, /openspec init --tools none "\$TARGET_PROJECT"/);
  assert.match(quickStart, /node bin\/falla-openspec\.js install "\$TARGET_PROJECT" \\\n  --tools claude,codex --with-figma --with-codegraph --with-lark --non-interactive/);
  assert.match(upgrade, /node bin\/falla-openspec\.js install "\$TARGET_PROJECT" --tools claude,codex --non-interactive/);
  assert.doesNotMatch(upgrade, /--with-(figma|codegraph|lark) --non-interactive/);
  assert.match(upgrade, /cat "\$TARGET_PROJECT\/\.falla\/install-manifest\.json"/);
  assert.match(upgrade, /少传一个工具/);
  assert.match(upgrade, /已有 change 不会被安装器改写/);
  assert.match(manual, /--with-figma/);
  assert.match(manual, /--with-codegraph/);
  assert.match(manual, /--with-lark/);
  assert.match(manual, /codegraph telemetry status/);
  assert.match(manual, /\.falla\/ui-knowledge\/\.index/);
  assert.match(manual, /没有 `--force`/);
  assert.match(manual, /不要删 `\.falla\/install-manifest\.json`/);
  assert.match(manual, /重开 Agent 会话/);
  assert.doesNotMatch(manual, /androidCopy|\$HOME\/android\/|\/Users\/|\/home\/|install-mainfest\.json/);
  assert.doesNotMatch(manual, /ui-knowledge index (build|sync|query)|coordination claim/);
});
