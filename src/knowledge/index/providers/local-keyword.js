import { createHash } from 'node:crypto';

export const LOCAL_KEYWORD_MODEL = 'local-keyword-v1';
export const DEFAULT_LOCAL_KEYWORD_DIMENSIONS = 512;

function characterNgrams(value, minimum = 3, maximum = 3) {
  const chars = [...value];
  const result = [];
  for (let size = minimum; size <= maximum; size += 1) {
    for (let index = 0; index + size <= chars.length; index += 1) {
      result.push(chars.slice(index, index + size).join(''));
    }
  }
  return result;
}

function tokenize(text) {
  const normalized = String(text).normalize('NFKC').toLowerCase();
  const tokens = [];
  for (const match of normalized.matchAll(/[a-z0-9]+/gu)) {
    const token = match[0];
    tokens.push(token);
    if (token.length >= 4 && token.length <= 64) tokens.push(...characterNgrams(token));
  }
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const chars = [...match[0]];
    tokens.push(...chars);
    tokens.push(...characterNgrams(match[0], 2, 3));
  }
  return tokens;
}


function normalize(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map(value => value / magnitude);
}

export class LocalKeywordEmbeddingProvider {
  constructor({
    model = LOCAL_KEYWORD_MODEL,
    dimensions = DEFAULT_LOCAL_KEYWORD_DIMENSIONS,
  } = {}) {
    if (model !== LOCAL_KEYWORD_MODEL || !Number.isInteger(dimensions) || dimensions < 64 || dimensions > 4096) {
      throw new TypeError('invalid local keyword configuration');
    }
    this.id = 'local-keyword';
    this.model = model;
    this.dimensions = dimensions;
    this.calls = 0;
  }

  async embed(texts) {
    if (!Array.isArray(texts) || texts.some(text => typeof text !== 'string')) {
      throw new TypeError('texts must be an array of strings');
    }
    this.calls += texts.length;
    return texts.map(text => {
      const frequencies = new Map();
      for (const token of tokenize(text)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      const vector = new Array(this.dimensions).fill(0);
      for (const [token, count] of frequencies) {
        const hash = createHash('sha256').update(token).digest();
        const index = hash.readUInt32BE(0) % this.dimensions;
        vector[index] += 1 + Math.log(count);
      }
      return normalize(vector);
    });
  }
}
