import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function put(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

export async function makeLegacyProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-legacy-'));
  await put(root, 'mercuryspec/config.yaml', 'schema: spec-driven\n');
  await put(root, 'mercuryspec/.DS_Store', 'ignored');
  await put(root, 'mercuryspec/specs/[Must Read]soul.md', 'OLD_WORKFLOW_RULE\n');
  await put(root, 'mercuryspec/specs/chat/spec.md', '# Chat capability\n');
  await put(root, 'mercuryspec/specs/chat/notes.md', '# Attachment\n');

  await put(root, 'mercuryspec/changes/medal/.openspec.yaml', 'schema: spec-driven\ncreated: 2026-07-27\n');
  await put(root, 'mercuryspec/changes/medal/proposal.md', '# Proposal\n');
  await put(root, 'mercuryspec/changes/medal/tasks.md', '- [ ] parent task\n');
  await put(
    root,
    'mercuryspec/changes/medal/changes/detail/.openspec.yaml',
    'schema: task-driven\ncreated: 2026-07-27\nparent: medal\ngoal: detail\n'
  );
  await put(root, 'mercuryspec/changes/medal/changes/detail/tasks.md', '- [ ] child task\n');
  await put(root, 'mercuryspec/changes/medal/changes/detail/comate.md', '# comate\n');
  await put(root, 'mercuryspec/changes/medal/changes/detail/figma/node.json', '{"id":"1"}\n');

  await put(
    root,
    'mercuryspec/changes/archive/2026-07-20-profile/.openspec.yaml',
    'schema: spec-driven\ncreated: 2026-07-19\n'
  );
  await put(root, 'mercuryspec/changes/archive/2026-07-20-profile/tasks.md', '- [x] parent\n');
  await put(
    root,
    'mercuryspec/changes/archive/2026-07-20-profile/changes/avatar/.openspec.yaml',
    'schema: task-driven\ncreated: 2026-07-19\nparent: profile\n'
  );
  await put(root, 'mercuryspec/changes/archive/2026-07-20-profile/changes/avatar/tasks.md', '- [x] child\n');

  await put(
    root,
    'mercuryspec/changes/archive/2026-07-21-flat-avatar/.openspec.yaml',
    'schema: task-driven\ncreated: 2026-07-20\nparent: profile\n'
  );
  await put(
    root,
    'mercuryspec/changes/archive/2026-07-21-flat-avatar/tasks.md',
    '- [x] flat child\n'
  );
  await put(
    root,
    'mercuryspec/changes/archive/2026-07-21-flat-avatar/comate.md',
    '# comate\n'
  );

  await put(root, 'mercuryspec/schemas/custom/schema.yaml', `name: custom
version: 1
description: custom workflow
artifacts:
  - id: tasks
    generates: tasks.md
    description: tasks
    requires: []
    template: |
      # Tasks

      - [ ] 1.1 work
    instruction: Read mercuryspec/specs before work.
apply:
  requires: [tasks]
  tracks: tasks.md
  instruction: Apply tasks.
`);

  await put(root, '.falla/spec/[分析必读]preflight.md', 'OLD_FALLA_RULE\n');
  await put(root, '.falla/skill-spec/[Must Read]soul.md', 'CURRENT_FALLA_RULE\n');
  await put(root, 'openspec/config.yaml', 'schema: custom-default\n');
  return root;
}
