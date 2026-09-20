import { createHash, randomUUID } from 'node:crypto';
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
const MAX_CHUNKS_BYTES = 64 * 1024 * 1024;
const MAX_VECTORS_BYTES = 128 * 1024 * 1024;
const INDEX_PARENT = path.posix.dirname(INDEX_ROOT);
const digest = value => createHash('sha256').update(value).digest('hex');

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
  if (value.counts.documents !== Object.keys(value.documents).length) {
    throw knowledgeError('invalid-index-manifest');
  }
  return value;
}

function assertSnapshot(manifest, chunks, vectorStore) {
  if (!isRecord(vectorStore)
    || vectorStore.formatVersion !== manifest.formatVersion
    || vectorStore.dimensions !== manifest.embedding.dimensions
    || !Array.isArray(vectorStore.vectors)) {
    throw knowledgeError('invalid-vector-store');
  }
  const documents = new Set(Object.keys(manifest.documents));
  const expectedChunks = new Set(Object.values(manifest.documents).flatMap(document => document.chunkIds));
  const chunkIds = new Set();
  for (const chunk of chunks) {
    if (!isRecord(chunk)
      || typeof chunk.chunkId !== 'string'
      || typeof chunk.documentId !== 'string'
      || !documents.has(chunk.documentId)
      || typeof chunk.text !== 'string'
      || typeof chunk.textHash !== 'string'
      || digest(chunk.text) !== chunk.textHash
      || chunkIds.has(chunk.chunkId)) {
      throw knowledgeError('invalid-chunk-store');
    }
    chunkIds.add(chunk.chunkId);
  }
  if (chunkIds.size !== expectedChunks.size
    || [...expectedChunks].some(chunkId => !chunkIds.has(chunkId))
    || manifest.counts.chunks !== chunks.length) {
    throw knowledgeError('invalid-chunk-store');
  }

  const vectorIds = new Set();
  for (const vector of vectorStore.vectors) {
    if (!isRecord(vector)
      || typeof vector.chunkId !== 'string'
      || vectorIds.has(vector.chunkId)
      || !chunkIds.has(vector.chunkId)
      || !Array.isArray(vector.values)
      || vector.values.length !== manifest.embedding.dimensions
      || vector.values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw knowledgeError('invalid-vector-store');
    }
    vectorIds.add(vector.chunkId);
  }
  if (vectorIds.size !== chunkIds.size || [...chunkIds].some(chunkId => !vectorIds.has(chunkId))) {
    throw knowledgeError('invalid-vector-store');
  }
  return { manifest, chunks, vectors: vectorStore };
}

async function writeExclusive(file, content) {
  await writeFile(file, content, { flag: 'wx', mode: 0o600 });
}

async function writeTempIndex(root, { manifest, chunks, vectors }) {
  assertSnapshot(assertIndexManifest(manifest), chunks, vectors);
  const tempRelative = `${INDEX_PARENT}/.index.tmp-${randomUUID()}`;
  const tempPath = path.join(root, ...tempRelative.split('/'));
  await mkdir(tempPath, { mode: 0o700 });
  try {
    await writeExclusive(path.join(tempPath, INDEX_FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeExclusive(
      path.join(tempPath, INDEX_FILES.chunks),
      chunks.map(chunk => JSON.stringify(chunk)).join('\n') + (chunks.length > 0 ? '\n' : '')
    );
    await writeExclusive(path.join(tempPath, INDEX_FILES.vectors), `${JSON.stringify(vectors)}\n`);
    return tempPath;
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true });
    throw error;
  }
}

async function requireIndexParent(root) {
  const parent = await inspectPath(root, INDEX_PARENT);
  if (!parent || !parent.stat.isDirectory()) throw knowledgeError('missing-knowledge-root');
}

export async function writeNewIndex(rootInput, payload) {
  const root = await knowledgeProjectRoot(rootInput);
  await requireIndexParent(root);
  const existing = await inspectPath(root, INDEX_ROOT);
  if (existing) throw knowledgeError('index-already-exists');
  const tempPath = await writeTempIndex(root, payload);
  const targetPath = path.join(root, ...INDEX_ROOT.split('/'));
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true });
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') throw knowledgeError('index-already-exists');
    throw error;
  }
}

export async function replaceIndex(rootInput, payload) {
  const root = await knowledgeProjectRoot(rootInput);
  await requireIndexParent(root);
  const existing = await inspectPath(root, INDEX_ROOT);
  if (!existing || !existing.stat.isDirectory()) throw knowledgeError('index-not-found');
  const tempPath = await writeTempIndex(root, payload);
  const targetPath = path.join(root, ...INDEX_ROOT.split('/'));
  const backupPath = path.join(root, ...`${INDEX_PARENT}/.index.backup-${randomUUID()}`.split('/'));
  await rename(targetPath, backupPath);
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await rename(backupPath, targetPath);
    await rm(tempPath, { recursive: true, force: true });
    throw error;
  }
  await rm(backupPath, { recursive: true, force: true });
}

export async function removeIndex(rootInput) {
  const root = await knowledgeProjectRoot(rootInput);
  const existing = await inspectPath(root, INDEX_ROOT);
  if (!existing) return false;
  if (!existing.stat.isDirectory()) throw knowledgeError('unsafe-index-path');
  await rm(existing.path, { recursive: true, force: false });
  return true;
}

export async function readIndexSnapshot(rootInput) {
  const root = await knowledgeProjectRoot(rootInput);
  const index = await inspectPath(root, INDEX_ROOT);
  if (!index) return null;
  if (!index.stat.isDirectory()) throw knowledgeError('unsafe-index-path');
  let manifest;
  let chunks;
  let vectors;
  try {
    manifest = JSON.parse((await readBoundedFile(
      root, `${INDEX_ROOT}/${INDEX_FILES.manifest}`, MAX_MANIFEST_BYTES
    )).toString('utf8'));
    const chunkText = (await readBoundedFile(
      root, `${INDEX_ROOT}/${INDEX_FILES.chunks}`, MAX_CHUNKS_BYTES
    )).toString('utf8').trim();
    chunks = chunkText ? chunkText.split('\n').map(line => JSON.parse(line)) : [];
    vectors = JSON.parse((await readBoundedFile(
      root, `${INDEX_ROOT}/${INDEX_FILES.vectors}`, MAX_VECTORS_BYTES
    )).toString('utf8'));
  } catch (error) {
    if (error?.details?.kind) throw error;
    throw knowledgeError('invalid-index-store');
  }
  return assertSnapshot(assertIndexManifest(manifest), chunks, vectors);
}

export async function readIndexManifest(rootInput) {
  return (await readIndexSnapshot(rootInput))?.manifest ?? null;
}
