import { knowledgeError } from '../files.js';
import { readIndexConfig } from './config.js';
import { loadIndexableKnowledge } from './documents.js';
import { createEmbeddingProvider } from './providers/provider.js';
import { readIndexSnapshot } from './store.js';

function magnitude(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function cosine(left, right) {
  if (left.length !== right.length) throw knowledgeError('invalid-vector-store');
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  const denominator = magnitude(left) * magnitude(right);
  return denominator === 0 ? 0 : dot / denominator;
}

function compatible(snapshot, provider) {
  const embedding = snapshot.manifest.embedding;
  return embedding.provider === provider.id
    && embedding.model === provider.model
    && embedding.dimensions === provider.dimensions;
}

function sectionWeight(section) {
  const weights = new Map([
    ['metadata', 1],
    ['适用场景', 0.95],
    ['目标场景', 0.95],
    ['使用示例', 0.85],
    ['最小使用示例', 0.85],
    ['依赖与接入条件', 0.75],
    ['状态、交互与生命周期', 0.7],
    ['状态与交互', 0.7],
    ['生命周期与风险', 0.65],
    ['结构', 0.6],
    ['overview', 0.6],
    ['子组件与拆分边界', 0.5],
    ['项目内验证证据', 0.45],
    ['风险与限制', 0.35],
    ['不适用场景', 0.15],
    ['设计依据', 0.1],
    ['视觉校准与设计依据', 0.1],
  ]);
  return weights.get(section) ?? 0.55;
}

export async function queryKnowledgeIndex(root, query, { topK } = {}) {
  const snapshot = await readIndexSnapshot(root);
  if (!snapshot) throw knowledgeError('index-not-found');
  const configResult = await readIndexConfig(root);
  const provider = createEmbeddingProvider(configResult.config.semantic);
  if (!compatible(snapshot, provider)) throw knowledgeError('index-rebuild-required');
  const effectiveTopK = topK ?? configResult.config.semantic.topK;
  const [queryVector] = await provider.embed([query]);
  if (!Array.isArray(queryVector) || queryVector.length !== provider.dimensions) {
    throw knowledgeError('invalid-embedding-result');
  }

  const chunks = new Map(snapshot.chunks.map(chunk => [chunk.chunkId, chunk]));
  const currentKnowledge = await loadIndexableKnowledge(root);
  const currentById = new Map(currentKnowledge.documents.map(document => [document.id, document]));
  const grouped = new Map();

  for (const vector of snapshot.vectors.vectors) {
    const chunk = chunks.get(vector.chunkId);
    if (!chunk) continue;
    const score = Math.max(0, cosine(queryVector, vector.values)) * sectionWeight(chunk.section);
    const candidate = grouped.get(chunk.documentId) ?? { score: -1, sections: [] };
    candidate.score = Math.max(candidate.score, score);
    candidate.sections.push({ section: chunk.section, score });
    grouped.set(chunk.documentId, candidate);
  }

  const candidates = [];
  for (const [id, match] of grouped) {
    const indexed = snapshot.manifest.documents[id];
    if (!indexed) continue;
    const current = currentById.get(id);
    const stale = !current || current.contentHash !== indexed.contentHash;
    const sections = [...match.sections]
      .sort((left, right) => right.score - left.score || left.section.localeCompare(right.section))
      .map(item => item.section)
      .filter((section, index, values) => values.indexOf(section) === index)
      .slice(0, 3);
    candidates.push({
      id,
      path: indexed.path,
      kind: indexed.kind,
      status: indexed.status,
      score: Number(match.score.toFixed(6)),
      matchedSections: sections,
      validation: stale ? 'stale' : 'current',
      reuseMode: stale ? 'rejected' : indexed.reuse,
    });
  }

  candidates.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return {
    ok: true,
    action: 'query',
    query,
    topK: effectiveTopK,
    provider: provider.id,
    model: provider.model,
    candidates: candidates.slice(0, effectiveTopK),
  };
}
