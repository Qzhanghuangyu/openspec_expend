import assert from 'node:assert/strict';
import test from 'node:test';
import YAML from 'yaml';

import {
  convertChangeMetadata,
  convertLegacySchema,
} from '../../src/migration/schema-converter.js';

test('旧内嵌 Schema 提取外置模板并改写受控旧路径', () => {
  const source = `name: custom
version: 1
description: custom
artifacts:
  - id: tasks
    generates: tasks.md
    description: tasks
    requires: []
    template: |
      # Tasks
      - [ ] work
    instruction: Read mercuryspec/specs first.
apply:
  requires: [tasks]
  tracks: tasks.md
  instruction: Apply.
`;
  const converted = convertLegacySchema(source, { source: 'mercuryspec/schemas/custom/schema.yaml' });
  const schema = YAML.parse(converted.schemaYaml);

  assert.equal(schema.artifacts[0].template, 'tasks.md');
  assert.equal(schema.artifacts[0].instruction, 'Read openspec/specs first.');
  assert.deepEqual(converted.templates, [{ path: 'templates/tasks.md', content: '# Tasks\n- [ ] work\n' }]);
});

test('Schema 转换拒绝未知字段，避免静默丢失语义', () => {
  assert.throws(
    () => convertLegacySchema(`name: custom
version: 1
description: custom
unknown: true
artifacts: []
apply:
  requires: []
  tracks: tasks.md
  instruction: apply
`, { source: 'schema.yaml' }),
    (error) => error.code === 1 && error.message.includes('不支持字段')
  );
});

test('父子 metadata 映射到 legacy Schema 并把 parent 移出官方元数据', () => {
  const parent = YAML.parse(convertChangeMetadata('schema: spec-driven\ncreated: 2026-07-27\n').content);
  const childResult = convertChangeMetadata(
    'schema: task-driven\ncreated: 2026-07-27\nparent: medal\ngoal: detail\n'
  );
  const child = YAML.parse(childResult.content);

  assert.equal(parent.schema, 'falla-legacy-spec-driven');
  assert.equal(child.schema, 'falla-legacy-task-driven');
  assert.equal(child.parent, undefined);
  assert.equal(child.goal, 'detail');
  assert.deepEqual(childResult.audit, { parent: 'medal' });
});
