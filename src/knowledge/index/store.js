import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  inspectPath,
  knowledgeError,
  knowledgeProjectRoot,
  readBoundedFile,
} from '../files.js';
import {
  CHUNK_STRATEGY_VERSION,
  INDEX_FILES,
  INDEX_FORMAT_VERSION,
  INDEX_ROOT,
  KNOWLEDGE_SCHEMA_VERSION,
} from './contract.js';

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const INDEX_PARENT = path.posix.dirname(INDEX_ROOT);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertIndexManifest(value) {
  if (!isRecord(value)
    || value.formatVersion !== INDEX_FORMAT_VERSION
    || value.knowledgeSchemaVersion !== KNOWLEDGE_SCHEMA_VERSION
    || value.chunkStrategyVersion !== CHUNK_STRATEGY_VERSION
    || typeof value.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.generatedAt))
    || !isRecord(value.embedding)
    || typeof value.embedding.provider !== 'string'
    || typeof value.embedding.model !== 'string'
    || !Number.isInteger(value.embedding.dimensions)
    || value.embedding.dimensions <= 0
    || !isRecord(value.counts)
    || !Number.isInteger(value.counts.documents)
    || !Number.isInteger(value.counts.chunks)
    || !Number.isInteger(value.counts.rejected)
    || !isRecord(value.documents)) {
    throw knowledgeError('invalid-index-manifest');
  }
  for (const [id, document] of Object.entries(value.documents)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)
      || !isRecord(document)
      || typeof document.path !== 'string'
      || !['component', 'screen-pattern'].includes(document.kind)
      || typeof document.status !== 'string'
      || !['reference-only', 'direct-reuse-candidate'].includes(document.reuse)
      || !/^[a-f0-9]{64}$/u.test(document.contentHash)
      || !Array.isArray(document.chunkIds)
      || document.chunkIds.some(chunkId => typeof chunkId !== 'string')) {
      throw knowledgeError('invalid-index-manifest');
    }
  }
  return value;
}

async function writeExclusive(file, content) {
  await writeFile(file, content, { flag: 'wx', mode: 0o600 });
}

export async function writeNewIndex(rootInput, { manifest, chunks, vectors }) {
  const root = await knowledgeProjectRoot(rootInput);
  const parent = await inspectPath(root, INDEX_PARENT);
  if (!parent || !parent.stat.isDirectory()) throw knowledgeError('missing-knowledge-root');
  const existing = await inspectPath(root, INDEX_ROOT);
  if (existing) throw knowledgeError('index-already-exists');

  assertIndexManifest(manifest);
  const tempRelative = `${INDEX_PARENT}/.index.tmp-${randomUUID()}`;
  const tempPath = path.join(root, ...tempRelative.split('/'));
  const targetPath = path.join(root, ...INDEX_ROOT.split('/'));
  await mkdir(tempPath, { mode: 0o700 });
  try {
    await writeExclusive(
      path.join(tempPath, INDEX_FILES.manifest),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    await writeExclusive(
      path.join(tempPath, INDEX_FILES.chunks),
      chunks.map(chunk => JSON.stringify(chunk)).join('\n') + (chunks.length > 0 ? '\n' : '')
    );
    await writeExclusive(
      path.join(tempPath, INDEX_FILES.vectors),
      `${JSON.stringify(vectors)}\n`
    );
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true });
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
      throw knowledgeError('index-already-exists');
    }
    throw error;
  }
}

export async function readIndexManifest(rootInput) {
  const root = await knowledgeProjectRoot(rootInput);
  const index = await inspectPath(root, INDEX_ROOT);
  if (!index) return null;
  if (!index.stat.isDirectory()) throw knowledgeError('unsafe-index-path');
  let value;
  try {
    value = JSON.parse((await readBoundedFile(
      root,
      `${INDEX_ROOT}/${INDEX_FILES.manifest}`,
      MAX_MANIFEST_BYTES
    )).toString('utf8'));
  } catch (error) {
    if (error?.details?.kind) throw error;
    throw knowledgeError('invalid-index-manifest');
  }
  return assertIndexManifest(value);
}
