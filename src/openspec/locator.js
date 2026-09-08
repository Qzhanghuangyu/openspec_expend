import { stat } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  const filesystemRoot = path.parse(current).root;

  while (current !== filesystemRoot) {
    if (await isDirectory(path.join(current, 'openspec'))) return current;
    current = path.dirname(current);
  }
  if (await isDirectory(path.join(filesystemRoot, 'openspec'))) return filesystemRoot;

  throw new FallaError(1, `找不到 openspec 项目根：${path.resolve(start)}`);
}
