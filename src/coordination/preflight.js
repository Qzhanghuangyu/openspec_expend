import YAML from 'yaml';

const MAX_PREFLIGHT_BYTES = 256 * 1024;
const MAX_BLOCKERS = 256;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = value => typeof value === 'string' && value.trim().length > 0;

/** 校验 preflight 顶部的决策台账；只返回类型和规范编号，不回传需求或确认正文。 */
export function validatePreflight(markdown) {
  const invalid = () => [{ kind: 'preflight-invalid' }];
  if (markdown === null) return [{ kind: 'preflight-unverified' }];
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_PREFLIGHT_BYTES) return invalid();
  const match = markdown.replace(/^\uFEFF/u, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return [{ kind: 'preflight-unverified' }];
  let record;
  try {
    // parse 与 toJS 的警告都可能包含正文；静默仅抑制输出，仍拒绝解析器收集的警告。
    const document = YAML.parseDocument(match[1], { logLevel: 'silent' });
    if (document.errors.length > 0 || document.warnings.length > 0) return invalid();
    record = document.toJS({ maxAliasCount: 0 });
  } catch {
    return invalid();
  }
  if (!isRecord(record) || record['falla-preflight'] !== 1
    || typeof record.reviewed !== 'boolean' || !Array.isArray(record.blockers)
    || record.blockers.length > MAX_BLOCKERS) return invalid();

  const ids = new Set();
  const errors = record.reviewed ? [] : [{ kind: 'preflight-unverified' }];
  for (const blocker of record.blockers) {
    if (!isRecord(blocker) || typeof blocker.id !== 'string' || !/^B[1-9]\d{0,5}$/u.test(blocker.id)
      || ids.has(blocker.id) || !hasText(blocker.scope)
      || !['pending', 'confirmed', 'excluded'].includes(blocker.status)
      || typeof blocker.decision !== 'string' || typeof blocker.evidence !== 'string') return invalid();
    ids.add(blocker.id);
    if (blocker.status === 'pending') {
      errors.push({ kind: 'preflight-blocker-unresolved', blocker: blocker.id });
    } else if (!hasText(blocker.decision) || !hasText(blocker.evidence)) {
      errors.push({ kind: 'preflight-decision-evidence-required', blocker: blocker.id });
    }
  }
  return errors;
}
