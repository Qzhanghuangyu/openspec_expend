import { createHash } from 'node:crypto';

import { knowledgeError } from '../files.js';

export const MAX_CHUNK_BYTES = 48 * 1024;
export const MAX_CHUNKS_PER_DOCUMENT = 64;

const digest = value => createHash('sha256').update(value).digest('hex');

function markdownBody(text) {
  const match = String(text).match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u);
  if (!match) throw knowledgeError('invalid-frontmatter');
  return String(text).slice(match[0].length);
}

function firstTitle(body, fallback) {
  for (const line of body.split(/\r?\n/u)) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/u);
    if (match) return match[1].trim();
  }
  return fallback;
}

function sectionKey(title) {
  const normalized = title.normalize('NFKC').toLowerCase()
    .replace(/[`*_~]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return normalized || `section-${digest(title.normalize('NFKC')).slice(0, 12)}`;
}

function sectionsFromBody(body) {
  const sections = [];
  let title = 'overview';
  let lines = [];
  let fence = null;

  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) sections.push({ title, text });
    lines = [];
  };

  for (const line of body.split(/\r?\n/u)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/u);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      lines.push(line);
      continue;
    }
    const heading = fence === null ? line.match(/^##\s+(.+?)\s*#*\s*$/u) : null;
    if (heading) {
      flush();
      title = heading[1].trim();
      lines.push(`## ${title}`);
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function markdownBlocks(text) {
  const blocks = [];
  let lines = [];
  let fence = null;
  const flush = () => {
    const block = lines.join('\n').trim();
    if (block) blocks.push(block);
    lines = [];
  };
  for (const line of text.split(/\r?\n/u)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/u);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
    }
    if (fence === null && line.trim() === '') flush();
    else lines.push(line);
  }
  flush();
  return blocks;
}

function splitSection(section) {
  if (Buffer.byteLength(section.text) <= MAX_CHUNK_BYTES) return [section.text];
  const blocks = markdownBlocks(section.text);
  const parts = [];
  let current = '';
  for (const block of blocks) {
    if (Buffer.byteLength(block) > MAX_CHUNK_BYTES) throw knowledgeError('knowledge-chunk-too-large');
    const candidate = current ? `${current}\n\n${block}` : block;
    if (Buffer.byteLength(candidate) > MAX_CHUNK_BYTES) {
      parts.push(current);
      current = block;
    } else current = candidate;
  }
  if (current) parts.push(current);
  return parts;
}

function metadataText(data, title) {
  const lines = [
    `title: ${title}`,
    `id: ${data.id}`,
    `kind: ${data.kind}`,
    `status: ${data.status}`,
    `platform: ${data.platform}`,
  ];
  for (const field of ['aliases', 'intents', 'tags']) {
    const values = data[field] ?? [];
    if (values.length > 0) lines.push(`${field}: ${values.join(' | ')}`);
  }
  const primary = data.codegraph?.['primary-symbol'];
  if (primary) lines.push(`primary-symbol: ${primary}`);
  return lines.join('\n');
}

export function chunkKnowledgeDocument({ file, kind, text, data, reuse }) {
  if (data?.kind !== kind || typeof data?.id !== 'string') throw knowledgeError('invalid-index-document');
  const body = markdownBody(text);
  const documentTitle = firstTitle(body, data.id);
  const chunks = [];
  const append = ({ id, section, content, ordinal }) => {
    if (Buffer.byteLength(content) > MAX_CHUNK_BYTES) throw knowledgeError('knowledge-chunk-too-large');
    chunks.push({
      chunkId: id,
      documentId: data.id,
      kind,
      status: data.status,
      reuse,
      path: file,
      section,
      ordinal,
      textHash: digest(content),
      text: content,
    });
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) throw knowledgeError('knowledge-chunk-budget-exceeded');
  };

  append({
    id: `${kind}:${data.id}#metadata`,
    section: 'metadata',
    content: metadataText(data, documentTitle),
    ordinal: 0,
  });

  const usedKeys = new Map();
  let ordinal = 1;
  for (const section of sectionsFromBody(body)) {
    const base = sectionKey(section.title);
    const count = (usedKeys.get(base) ?? 0) + 1;
    usedKeys.set(base, count);
    const unique = count === 1 ? base : `${base}-${count}`;
    const parts = splitSection(section);
    for (let index = 0; index < parts.length; index += 1) {
      append({
        id: `${kind}:${data.id}#${unique}${parts.length === 1 ? '' : `-part-${index + 1}`}`,
        section: section.title,
        content: parts[index],
        ordinal: ordinal++,
      });
    }
  }
  return chunks;
}
