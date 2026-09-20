import { createHash } from 'node:crypto';
import {
  MAX_ENTRY_BYTES, MAX_EVIDENCE_BYTES, knowledgeError,
  knowledgeProjectRoot, listKnowledgeEntries, readBoundedFile, safeRelative,
} from './files.js';
import { parseKnowledge, validateMetadata } from './schema.js';

const digest = content => createHash('sha256').update(content).digest('hex');

export async function readKnowledgeEntry(root, file, kind) {
  const text = (await readBoundedFile(root, file, MAX_ENTRY_BYTES)).toString('utf8');
  // Only flag recognizable assignments, never echo the matching text.
  if (/(?:api[_-]?key|access[_-]?token|cookie|password)\s*[:=]\s*["']?[^\s"']{8,}/iu.test(text)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text)) {
    throw knowledgeError('sensitive-content');
  }
  const data = parseKnowledge(text);
  return { text, data, ...validateMetadata(data, kind) };
}

async function evidenceHashes(root, references, budget) {
  const hashes = {};
  const issues = [];
  for (const file of references) {
    try {
      if (budget.files >= 2000 || budget.bytes >= 64 * 1024 * 1024) throw knowledgeError('evidence-budget-exceeded');
      budget.files += 1;
      const bytes = await readBoundedFile(root, file, MAX_EVIDENCE_BYTES);
      budget.bytes += bytes.length;
      hashes[file] = digest(bytes);
    } catch (error) {
      issues.push(error?.details?.kind ?? 'unreadable-evidence');
    }
  }
  return { hashes, issues };
}

export async function validateKnowledge(rootInput) {
  const errors = [];
  const warnings = [];
  const entries = [];
  try {
    const root = await knowledgeProjectRoot(rootInput);
    const listing = await listKnowledgeEntries(root);
    errors.push(...listing.errors);
    const ids = new Map();
    const budget = { files: 0, bytes: 0 };
    for (const { file, kind } of listing.entries) {
      const result = { entry: file, reuse: 'rejected' };
      entries.push(result);
      try {
        const parsed = await readKnowledgeEntry(root, file, kind);
        const { data, references } = parsed;
        const local = [...parsed.issues];
        if (typeof data.id === 'string') {
          if (ids.has(data.id)) {
            local.push('duplicate-id');
            const previous = ids.get(data.id);
            previous.reuse = 'rejected';
            errors.push({ kind: 'duplicate-id', entry: previous.entry });
          } else ids.set(data.id, result);
        }
        // Unsafe metadata is rejected before any referenced file is opened.
        if (local.length === 0) {
          const evidence = await evidenceHashes(root, references, budget);
          const stale = references.some(file => parsed.hashes[file] && evidence.hashes[file]
            && parsed.hashes[file] !== evidence.hashes[file]);
          const evidenceIssues = [...evidence.issues, ...(stale ? ['stale-evidence'] : [])];
          if (['invalid', 'deprecated'].includes(data.status)) {
            warnings.push(...evidenceIssues.map(kind => ({ kind, entry: file })));
          } else local.push(...evidenceIssues);
        }
        errors.push(...[...new Set(local)].map(kind => ({ kind, entry: file })));
        if (local.length === 0 && data.status === 'draft') result.reuse = 'reference-only';
        if (local.length === 0 && data.status === 'verified') result.reuse = 'direct-reuse-candidate';
      } catch (error) {
        errors.push({ kind: error?.details?.kind ?? 'unreadable-entry', entry: file });
      }
    }
  } catch (error) {
    errors.push({ kind: error?.details?.kind ?? 'unreadable-project' });
  }
  return { ok: errors.length === 0, entries, errors, warnings };
}

export async function fingerprintEntry(rootInput, relative) {
  const file = safeRelative(relative);
  const match = file.match(/^\.falla\/ui-knowledge\/(components|screen-patterns)\/[^/]+\.md$/u);
  if (!match) throw knowledgeError('invalid-entry-path');
  const root = await knowledgeProjectRoot(rootInput);
  const parsed = await readKnowledgeEntry(root, file, match[1] === 'components' ? 'component' : 'screen-pattern');
  // Refreshing evidence is allowed for any status, but does not grant verification.
  const pendingVerification = new Set(['reviewer-required', 'verification-date-required', 'invalid-verification-date', 'evidence-hash-required', 'invalid-source-hashes']);
  const invalid = parsed.issues.find(kind => !pendingVerification.has(kind));
  if (invalid) throw knowledgeError(invalid);
  const result = await evidenceHashes(root, parsed.references, { files: 0, bytes: 0 });
  if (result.issues.length > 0) throw knowledgeError(result.issues[0]);
  return { entry: file, sourceHashes: result.hashes };
}
