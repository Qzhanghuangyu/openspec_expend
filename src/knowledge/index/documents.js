import { createHash } from 'node:crypto';

import {
  knowledgeProjectRoot,
  listKnowledgeEntries,
} from '../files.js';
import {
  readKnowledgeEntry,
  validateKnowledge,
} from '../validate.js';
import { chunkKnowledgeDocument } from './chunker.js';

const digest = value => createHash('sha256').update(value).digest('hex');

export async function loadIndexableKnowledge(rootInput) {
  const root = await knowledgeProjectRoot(rootInput);
  const validation = await validateKnowledge(root);
  const reuseByPath = new Map(validation.entries.map(entry => [entry.entry, entry.reuse]));
  const listing = await listKnowledgeEntries(root);
  const documents = [];

  for (const { file, kind } of listing.entries) {
    const reuse = reuseByPath.get(file) ?? 'rejected';
    if (reuse === 'rejected') continue;
    const parsed = await readKnowledgeEntry(root, file, kind);
    if (parsed.issues.length > 0) continue;
    documents.push({
      id: parsed.data.id,
      kind,
      status: parsed.data.status,
      reuse,
      path: file,
      contentHash: digest(parsed.text),
      chunks: chunkKnowledgeDocument({
        file,
        kind,
        text: parsed.text,
        data: parsed.data,
        reuse,
      }),
    });
  }

  return {
    validation,
    documents: documents.sort((left, right) => left.id.localeCompare(right.id)),
  };
}
