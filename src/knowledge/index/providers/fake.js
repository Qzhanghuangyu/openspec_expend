import { createHash } from 'node:crypto';

import {
  DEFAULT_FAKE_DIMENSIONS,
  FAKE_PROVIDER_MODEL,
} from '../config.js';

function normalize(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map(value => value / magnitude);
}

export class FakeEmbeddingProvider {
  constructor({ model = FAKE_PROVIDER_MODEL, dimensions = DEFAULT_FAKE_DIMENSIONS } = {}) {
    if (typeof model !== 'string' || !model || !Number.isInteger(dimensions) || dimensions <= 0) {
      throw new TypeError('invalid fake embedding configuration');
    }
    this.id = 'fake';
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
      const vector = new Array(this.dimensions).fill(0);
      for (let index = 0; index < this.dimensions; index += 1) {
        const block = createHash('sha256')
          .update(this.model)
          .update('\0')
          .update(String(index))
          .update('\0')
          .update(text)
          .digest();
        vector[index] = (block.readUInt32BE(0) / 0xffffffff) * 2 - 1;
      }
      return normalize(vector);
    });
  }
}
