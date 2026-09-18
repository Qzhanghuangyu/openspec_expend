import YAML from 'yaml';
import { knowledgeError, evidencePath } from './files.js';

export const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function parseKnowledge(text) {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw knowledgeError('invalid-frontmatter');
  try {
    const document = YAML.parse(match[1], { maxAliasCount: 20, uniqueKeys: true });
    if (!isRecord(document)) throw knowledgeError('invalid-frontmatter');
    return document;
  } catch {
    throw knowledgeError('invalid-frontmatter');
  }
}

export function validateMetadata(data, expectedKind) {
  const issues = [];
  const add = kind => issues.push(kind);
  if (data['schema-version'] !== 1) add('invalid-schema-version');
  if (typeof data.id !== 'string' || data.id.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(data.id)) add('invalid-id');
  if (data.kind !== expectedKind) add('invalid-kind');
  if (data.scope !== 'project') add('invalid-scope');
  if (!['draft', 'verified', 'deprecated', 'invalid'].includes(data.status)) add('invalid-status');
  if (!['android-view', 'compose'].includes(data.platform)) add('invalid-platform');
  for (const key of ['aliases', 'intents', 'tags']) {
    if (!Array.isArray(data[key]) || data[key].length > 64
      || data[key].some(value => typeof value !== 'string' || value.length > 300)) add(`invalid-${key}`);
  }
  if (!isRecord(data.codegraph) || typeof data.codegraph['primary-symbol'] !== 'string'
    || !Array.isArray(data.codegraph['related-symbols'])
    || data.codegraph['related-symbols'].length > 64
    || data.codegraph['related-symbols'].some(symbol => typeof symbol !== 'string' || symbol.length > 512)) {
    add('invalid-codegraph-binding');
  }
  const files = [];
  for (const key of ['source-files', 'layout-resources', 'tests']) {
    if (!Array.isArray(data[key]) || data[key].length > 64) {
      add(`invalid-${key}`);
      continue;
    }
    for (const value of data[key]) {
      try { files.push(evidencePath(value)); } catch (error) { add(error.details.kind); }
    }
  }
  const references = [...new Set(files)];
  if (references.length > 64) add('evidence-budget-exceeded');
  const hashes = data['source-hashes'] ?? {};
  if (!isRecord(hashes) || Object.keys(hashes).length > 64
    || Object.entries(hashes).some(([file, hash]) => !references.includes(file) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash))) {
    add('invalid-source-hashes');
  }
  if (data.status === 'verified') {
    if (typeof data['verified-by'] !== 'string' || !data['verified-by'].trim()
      || ['human', 'ai', 'ai-assisted', 'reviewer'].includes(data['verified-by'].trim().toLowerCase())) add('reviewer-required');
    const date = data['last-verified'];
    if (!date) add('verification-date-required');
    else if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date
      || date > new Date().toISOString().slice(0, 10)) add('invalid-verification-date');
    if (!Array.isArray(data['source-files']) || data['source-files'].length === 0) add('source-evidence-required');
    if (typeof data.codegraph?.['primary-symbol'] !== 'string'
      || !data.codegraph['primary-symbol'].trim()) add('primary-symbol-required');
    if (references.some(file => !isRecord(hashes) || !Object.hasOwn(hashes, file))) add('evidence-hash-required');
  }
  return { issues: [...new Set(issues)], references: references.slice(0, 64), hashes };
}
