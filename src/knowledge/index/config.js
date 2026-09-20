import YAML from 'yaml';

import { knowledgeError } from '../files.js';
import {
  KNOWLEDGE_ROOT,
  inspectPath,
  knowledgeProjectRoot,
  readBoundedFile,
} from '../files.js';
import {
  DEFAULT_TOP_K,
  INDEX_ROOT,
  MAX_TOP_K,
} from './contract.js';

export const INDEX_CONFIG_PATH = `${KNOWLEDGE_ROOT}/config.yaml`;
export const MAX_INDEX_CONFIG_BYTES = 64 * 1024;
export const FAKE_PROVIDER_MODEL = 'fake-v1';
export const DEFAULT_FAKE_DIMENSIONS = 32;
export const LOCAL_KEYWORD_MODEL = 'local-keyword-v1';
export const DEFAULT_LOCAL_KEYWORD_DIMENSIONS = 512;

const COMPONENT_PATH = `${KNOWLEDGE_ROOT}/components`;
const SCREEN_PATTERN_PATH = `${KNOWLEDGE_ROOT}/screen-patterns`;
const PROVIDERS = new Set(['unconfigured', 'fake', 'local-keyword']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configError(kind = 'invalid-index-config') {
  return knowledgeError(kind);
}

function exactStringArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function parsePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > max) throw configError();
  return candidate;
}

export function defaultIndexConfig() {
  return {
    version: 1,
    scope: 'project',
    knowledge: {
      sourceOfTruth: 'markdown',
      componentPaths: [COMPONENT_PATH],
      screenPatternPaths: [SCREEN_PATTERN_PATH],
    },
    semantic: {
      provider: 'unconfigured',
      model: 'unconfigured',
      dimensions: null,
      indexPath: INDEX_ROOT,
      topK: DEFAULT_TOP_K,
    },
    retrieval: {
      projectOnly: true,
      requireVerifiedForDirectReuse: true,
      allowDraftAsReference: true,
      rejectInvalid: true,
    },
  };
}

export function validateIndexConfig(value) {
  if (!isRecord(value) || value.version !== 1 || value.scope !== 'project') throw configError();
  if (!isRecord(value.knowledge)
    || value.knowledge.sourceOfTruth !== 'markdown'
    || !exactStringArray(value.knowledge.componentPaths, [COMPONENT_PATH])
    || !exactStringArray(value.knowledge.screenPatternPaths, [SCREEN_PATTERN_PATH])) {
    throw configError();
  }

  if (!isRecord(value.semantic)) throw configError();
  const provider = value.semantic.provider;
  if (!PROVIDERS.has(provider) || value.semantic.indexPath !== INDEX_ROOT) throw configError();
  const topK = parsePositiveInteger(value.semantic.topK, DEFAULT_TOP_K, MAX_TOP_K);

  let model = value.semantic.model;
  let dimensions = value.semantic.dimensions;
  if (provider === 'unconfigured') {
    if (model !== undefined && model !== 'unconfigured') throw configError();
    if (dimensions !== undefined && dimensions !== null) throw configError();
    model = 'unconfigured';
    dimensions = null;
  } else if (provider === 'fake') {
    model ??= FAKE_PROVIDER_MODEL;
    if (typeof model !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/iu.test(model)) throw configError();
    dimensions = parsePositiveInteger(dimensions, DEFAULT_FAKE_DIMENSIONS, 4096);
  } else {
    model ??= LOCAL_KEYWORD_MODEL;
    if (model !== LOCAL_KEYWORD_MODEL) throw configError();
    dimensions = parsePositiveInteger(dimensions, DEFAULT_LOCAL_KEYWORD_DIMENSIONS, 4096);
    if (dimensions < 64) throw configError();
  }

  const retrieval = value.retrieval ?? {};
  if (!isRecord(retrieval)) throw configError();
  const normalizedRetrieval = {
    projectOnly: retrieval.projectOnly ?? true,
    requireVerifiedForDirectReuse: retrieval.requireVerifiedForDirectReuse ?? true,
    allowDraftAsReference: retrieval.allowDraftAsReference ?? true,
    rejectInvalid: retrieval.rejectInvalid ?? true,
  };
  if (Object.values(normalizedRetrieval).some(entry => typeof entry !== 'boolean')
    || normalizedRetrieval.projectOnly !== true
    || normalizedRetrieval.requireVerifiedForDirectReuse !== true
    || normalizedRetrieval.rejectInvalid !== true) {
    throw configError();
  }

  return {
    version: 1,
    scope: 'project',
    knowledge: defaultIndexConfig().knowledge,
    semantic: { provider, model, dimensions, indexPath: INDEX_ROOT, topK },
    retrieval: normalizedRetrieval,
  };
}

export async function readIndexConfig(rootInput) {
  const root = await knowledgeProjectRoot(rootInput);
  const target = await inspectPath(root, INDEX_CONFIG_PATH);
  if (!target) return { source: 'default', config: defaultIndexConfig() };
  if (!target.stat.isFile()) throw configError('unsafe-index-config');
  const text = (await readBoundedFile(root, INDEX_CONFIG_PATH, MAX_INDEX_CONFIG_BYTES)).toString('utf8');
  if (/(?:api[_-]?key|access[_-]?token|cookie|password)\s*[:=]\s*["']?[^\s"']{8,}/iu.test(text)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text)) {
    throw configError('sensitive-index-config');
  }
  let parsed;
  try {
    parsed = YAML.parse(text, { maxAliasCount: 20, uniqueKeys: true });
  } catch {
    throw configError();
  }
  return { source: 'project', config: validateIndexConfig(parsed) };
}
