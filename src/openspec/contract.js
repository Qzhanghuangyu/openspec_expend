import { FallaError } from '../errors.js';

function incompatible(field, expected) {
  throw new FallaError(3, `OpenSpec JSON 契约不兼容：${field} 应为 ${expected}`, { field });
}

function assertRecord(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    incompatible(field, 'object');
  }
}

function assertString(value, field) {
  if (typeof value !== 'string') incompatible(field, 'string');
}

function assertNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) incompatible(field, 'number');
}

function assertBoolean(value, field) {
  if (typeof value !== 'boolean') incompatible(field, 'boolean');
}

function assertArray(value, field) {
  if (!Array.isArray(value)) incompatible(field, 'array');
}

function assertRoot(value, field) {
  assertRecord(value, field);
  assertString(value.path, `${field}.path`);
  assertString(value.source, `${field}.source`);
}

export function assertListContract(value) {
  assertRecord(value, 'list');
  assertArray(value.changes, 'list.changes');
  for (const [index, change] of value.changes.entries()) {
    assertRecord(change, `list.changes[${index}]`);
    assertString(change.name, `list.changes[${index}].name`);
    assertString(change.status, `list.changes[${index}].status`);
  }
  assertRoot(value.root, 'list.root');
  return value;
}

export function assertStatusContract(value) {
  assertRecord(value, 'status');
  assertString(value.changeName, 'status.changeName');
  assertString(value.schemaName, 'status.schemaName');
  assertBoolean(value.isComplete, 'status.isComplete');
  assertArray(value.artifacts, 'status.artifacts');
  for (const [index, artifact] of value.artifacts.entries()) {
    const field = `status.artifacts[${index}]`;
    assertRecord(artifact, field);
    assertString(artifact.id, `${field}.id`);
    assertString(artifact.outputPath, `${field}.outputPath`);
    assertString(artifact.status, `${field}.status`);
  }
  if (value.applyRequires !== undefined) assertArray(value.applyRequires, 'status.applyRequires');
  return value;
}

function assertArtifactInstructions(value) {
  assertString(value.artifactId, 'instructions.artifactId');
  assertString(value.outputPath, 'instructions.outputPath');
  assertString(value.resolvedOutputPath, 'instructions.resolvedOutputPath');
  assertArray(value.existingOutputPaths, 'instructions.existingOutputPaths');
  assertString(value.template, 'instructions.template');
  assertArray(value.dependencies, 'instructions.dependencies');
}

function assertApplyInstructions(value) {
  assertRecord(value.contextFiles, 'instructions.contextFiles');
  assertRecord(value.progress, 'instructions.progress');
  assertNumber(value.progress.total, 'instructions.progress.total');
  assertNumber(value.progress.complete, 'instructions.progress.complete');
  assertNumber(value.progress.remaining, 'instructions.progress.remaining');
  assertArray(value.tasks, 'instructions.tasks');
  assertString(value.state, 'instructions.state');
}

export function assertInstructionsContract(value) {
  assertRecord(value, 'instructions');
  assertString(value.changeName, 'instructions.changeName');
  assertString(value.schemaName, 'instructions.schemaName');
  assertString(value.instruction, 'instructions.instruction');
  if (value.artifactId !== undefined) {
    assertArtifactInstructions(value);
  } else {
    assertApplyInstructions(value);
  }
  return value;
}
