import path from 'node:path';
import YAML from 'yaml';

import { FallaError } from '../errors.js';

const TOP_LEVEL_FIELDS = new Set(['name', 'version', 'description', 'artifacts', 'apply']);
const ARTIFACT_FIELDS = new Set([
  'id', 'generates', 'description', 'requires', 'template', 'instruction',
]);
const APPLY_FIELDS = new Set(['requires', 'tracks', 'instruction']);
const SCHEMA_NAMES = {
  'spec-driven': 'falla-legacy-spec-driven',
  'task-driven': 'falla-legacy-task-driven',
};

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownFields(record, allowed, source) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new FallaError(1, `Schema 含不支持字段 ${key}：${source}`);
  }
}

function parseYaml(content, source) {
  try {
    return YAML.parse(content, { maxAliasCount: 100 });
  } catch {
    throw new FallaError(1, `YAML 无法解析：${source}`);
  }
}

function controlledPathRewrite(value) {
  return typeof value === 'string'
    ? value.replaceAll('mercuryspec/specs', 'openspec/specs')
    : value;
}

function assertExternalTemplate(value, source) {
  const normalized = path.posix.normalize(value);
  if (path.posix.isAbsolute(value) || normalized === '..' || normalized.startsWith('../')) {
    throw new FallaError(1, `Schema 模板路径越界：${source}`);
  }
  return normalized;
}

export function convertLegacySchema(content, options = {}) {
  const source = options.source ?? 'schema.yaml';
  const document = parseYaml(content, source);
  if (!isRecord(document)) throw new FallaError(1, `Schema 必须是对象：${source}`);
  rejectUnknownFields(document, TOP_LEVEL_FIELDS, source);
  if (typeof document.name !== 'string' || !Array.isArray(document.artifacts) || !isRecord(document.apply)) {
    throw new FallaError(1, `Schema 缺少 name、artifacts 或 apply：${source}`);
  }
  rejectUnknownFields(document.apply, APPLY_FIELDS, source);

  const templates = [];
  document.name = SCHEMA_NAMES[document.name] ?? document.name;
  document.artifacts = document.artifacts.map((artifact, index) => {
    if (!isRecord(artifact)) throw new FallaError(1, `Schema artifact 无效：${source}#${index}`);
    rejectUnknownFields(artifact, ARTIFACT_FIELDS, `${source}#${index}`);
    if (typeof artifact.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(artifact.id)) {
      throw new FallaError(1, `Schema artifact id 无效：${source}#${index}`);
    }
    if (typeof artifact.template !== 'string' || artifact.template.length === 0) {
      throw new FallaError(1, `Schema artifact template 无效：${source}#${index}`);
    }
    const converted = { ...artifact };
    if (artifact.template.includes('\n')) {
      const templateName = `${artifact.id}.md`;
      templates.push({ path: `templates/${templateName}`, content: controlledPathRewrite(artifact.template) });
      converted.template = templateName;
    } else {
      converted.template = assertExternalTemplate(artifact.template, source);
    }
    converted.instruction = controlledPathRewrite(converted.instruction);
    return converted;
  });
  document.apply = {
    ...document.apply,
    instruction: controlledPathRewrite(document.apply.instruction),
  };
  return {
    name: document.name,
    schemaYaml: YAML.stringify(document, { lineWidth: 0 }),
    templates,
    skipSpecs: !document.artifacts.some((artifact) =>
      typeof artifact.generates === 'string'
      && (artifact.generates === 'specs' || artifact.generates.startsWith('specs/'))),
  };
}

export function convertChangeMetadata(content, options = {}) {
  const source = options.source ?? '.openspec.yaml';
  const document = parseYaml(content, source);
  if (!isRecord(document) || typeof document.schema !== 'string') {
    throw new FallaError(1, `change metadata 缺少 schema：${source}`);
  }
  for (const field of ['skip_specs', 'retire_capabilities']) {
    if (document[field] !== undefined && typeof document[field] !== 'boolean') {
      throw new FallaError(1, `change metadata ${field} 必须是 boolean：${source}`);
    }
  }
  const audit = {};
  if (document.parent !== undefined) {
    if (typeof document.parent !== 'string') {
      throw new FallaError(1, `change metadata parent 无效：${source}`);
    }
    audit.parent = document.parent;
    delete document.parent;
  }
  document.schema = SCHEMA_NAMES[document.schema] ?? document.schema;
  const schemasWithoutSpecs = new Set([
    'falla-task-driven',
    'falla-legacy-task-driven',
    ...(options.schemasWithoutSpecs ?? []),
  ]);
  if (document.skip_specs === undefined && schemasWithoutSpecs.has(document.schema)) {
    document.skip_specs = true;
  }
  return { content: YAML.stringify(document, { lineWidth: 0 }), audit };
}
