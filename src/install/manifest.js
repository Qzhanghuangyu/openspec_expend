import { readFile } from 'node:fs/promises';

import { FallaError } from '../errors.js';
import {
  assertRelativePath,
  readProjectFile,
  writeAtomicFile,
} from './files.js';

const MANIFEST_PATH = '.falla/install-manifest.json';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const V1_KEYS = ['fallaVersion', 'files', 'formatVersion', 'installedAt', 'openSpecVersion'];
const V2_KEYS = [...V1_KEYS, 'tools'].sort();
const V3_KEYS = [...V2_KEYS, 'integrations'].sort();
const TOOL_IDS = new Set(['claude', 'codex']);
const packageFile = new URL('../../package.json', import.meta.url);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertInstallManifest(value) {
  if (!isRecord(value) || ![1, 2, 3].includes(value.formatVersion)) {
    throw new FallaError(1, 'install-manifest.json 格式不兼容');
  }
  const expectedKeys = value.formatVersion === 1
    ? V1_KEYS
    : value.formatVersion === 2 ? V2_KEYS : V3_KEYS;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw new FallaError(1, 'install-manifest.json 含未知或缺失字段');
  }
  if (typeof value.fallaVersion !== 'string'
    || typeof value.openSpecVersion !== 'string'
    || typeof value.installedAt !== 'string'
    || !isRecord(value.files)) {
    throw new FallaError(1, 'install-manifest.json 字段类型无效');
  }
  if (value.formatVersion >= 2) {
    if (!Array.isArray(value.tools)
      || value.tools.some((tool) => typeof tool !== 'string' || !TOOL_IDS.has(tool))
      || new Set(value.tools).size !== value.tools.length
      || JSON.stringify([...value.tools].sort()) !== JSON.stringify(value.tools)) {
      throw new FallaError(1, 'install-manifest.json tools 字段无效');
    }
  }
  if (value.formatVersion === 3) {
    if (!isRecord(value.integrations)
      || JSON.stringify(Object.keys(value.integrations).sort()) !== JSON.stringify(['codegraph'])
      || typeof value.integrations.codegraph !== 'boolean') {
      throw new FallaError(1, 'install-manifest.json integrations 字段无效');
    }
  }
  for (const [relativePath, digest] of Object.entries(value.files)) {
    if (assertRelativePath(relativePath) !== relativePath || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new FallaError(1, `install-manifest.json 文件记录无效：${relativePath}`);
    }
  }
  return value;
}

export async function loadInstallManifest(root) {
  const content = await readProjectFile(root, MANIFEST_PATH);
  if (content === null) return null;
  if (content.byteLength > MAX_MANIFEST_BYTES) {
    throw new FallaError(1, 'install-manifest.json 超过 1 MiB 限制');
  }
  try {
    return assertInstallManifest(JSON.parse(content.toString('utf8')));
  } catch (error) {
    if (error instanceof FallaError) throw error;
    throw new FallaError(1, 'install-manifest.json 不是有效 JSON');
  }
}

export async function getFallaVersion() {
  const packageDocument = JSON.parse(await readFile(packageFile, 'utf8'));
  if (typeof packageDocument.version !== 'string') {
    throw new FallaError(1, 'package.json 缺少版本号');
  }
  return packageDocument.version;
}

export function manifestsMatch(left, right) {
  if (!left || !right) return false;
  return left.formatVersion === right.formatVersion
    && left.fallaVersion === right.fallaVersion
    && left.openSpecVersion === right.openSpecVersion
    && JSON.stringify(left.tools ?? []) === JSON.stringify(right.tools ?? [])
    && JSON.stringify(left.integrations ?? {}) === JSON.stringify(right.integrations ?? {})
    && JSON.stringify(left.files) === JSON.stringify(right.files);
}

export async function saveInstallManifest(root, manifest) {
  assertInstallManifest(manifest);
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const existing = await readProjectFile(root, MANIFEST_PATH);
  if (existing?.toString('utf8') === content) return false;
  await writeAtomicFile(root, MANIFEST_PATH, content);
  return true;
}
