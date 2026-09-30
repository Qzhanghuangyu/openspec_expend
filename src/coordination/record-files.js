import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { FallaError } from '../errors.js';

export const MAX_RECORD_BYTES = 256 * 1024;
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

async function entry(candidate) {
  try { return await lstat(candidate); } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

/** 校验每一级真实目录，不能通过祖先符号链接读取其他 change 的证据。 */
export async function assertRecordDirectory(rootInput, directoryInput) {
  const suppliedRoot = path.resolve(rootInput);
  const root = await realpath(suppliedRoot);
  const suppliedDirectory = path.resolve(directoryInput);
  // macOS 的 /var、/tmp 等项目根别名先统一；仅允许根别名，不允许根内祖先链接。
  const relative = inside(suppliedRoot, suppliedDirectory)
    ? path.relative(suppliedRoot, suppliedDirectory)
    : inside(root, suppliedDirectory) ? path.relative(root, suppliedDirectory) : null;
  if (relative === null) throw new FallaError(1, 'change 路径越过项目边界');
  const directory = path.join(root, relative);
  let current = root;
  for (const segment of path.relative(root, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await entry(current);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new FallaError(1, 'change 必须是项目内真实目录，不能是符号链接');
    }
  }
  return { root, directory };
}

/** 上限读取并固定最终文件句柄；文件增长不绕过预算，失败或成功均关闭句柄。 */
export async function readChangeRecordFile(rootInput, changePath, filename, optional = false) {
  const { directory } = await assertRecordDirectory(rootInput, changePath);
  if (typeof filename !== 'string' || path.basename(filename) !== filename || ['.', '..'].includes(filename)) {
    throw new FallaError(1, '记录文件名无效');
  }
  const file = path.join(directory, filename);
  const stat = await entry(file);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new FallaError(1, `${filename} 必须是普通文件，不能是符号链接`);
  if (stat.size > MAX_RECORD_BYTES) throw new FallaError(1, `${filename} 超过 256 KiB 限制`);
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_RECORD_BYTES || opened.ino !== stat.ino || opened.dev !== stat.dev) {
      throw new FallaError(1, '记录文件在读取前发生变化或超过预算');
    }
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_RECORD_BYTES) throw new FallaError(1, `${filename} 超过 256 KiB 限制`);
    return buffer.subarray(0, length).toString('utf8');
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}
