import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { installProject } from '../../src/commands/install.js';

const execFileAsync = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'falla-install-smoke-'));
await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
const report = await installProject({
  root,
  tools: ['claude', 'codex'],
  interactive: false,
  executable: 'openspec',
});

assert.equal(report.ok, true);
for (const relative of [
  '.falla/install-manifest.json',
  '.falla/skill-spec/[Must Read]soul.md',
  '.claude/hooks/falla-spec-guard.mjs',
  '.codex/hooks/falla-spec-session.mjs',
  '.claude/skills/falla-preflight/SKILL.md',
  '.codex/skills/falla-archive-change/SKILL.md',
  'openspec/schemas/falla-spec-driven/schema.yaml',
  'openspec/schemas/falla-task-driven/schema.yaml',
]) {
  await access(path.join(root, relative));
}

process.stdout.write('install smoke: ok\n');
