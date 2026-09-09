import { FallaError } from '../errors.js';

export const SUPPORTED_OPENSPEC_RANGE = '>=1.12.0 <1.13.0';

export function parseOpenSpecVersion(text) {
  const raw = String(text).trim();
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new FallaError(2, '无法识别 OpenSpec 版本；预期格式为 major.minor.patch');
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw,
  };
}

export function assertSupportedVersion(text) {
  const version = parseOpenSpecVersion(text);
  if (version.major !== 1 || version.minor !== 12) {
    throw new FallaError(
      2,
      `OpenSpec ${version.raw} 不在支持范围 ${SUPPORTED_OPENSPEC_RANGE}`,
      { version: version.raw, supportedRange: SUPPORTED_OPENSPEC_RANGE }
    );
  }
  return version;
}
