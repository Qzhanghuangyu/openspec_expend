import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function snapshotTree(root, options = {}, relative = '') {
  const excluded = options.exclude ?? [];
  const result = {};
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name).split(path.sep).join('/');
    if (excluded.some((prefix) => child === prefix || child.startsWith(`${prefix}/`))) continue;
    const absolute = path.join(root, child);
    const metadata = await lstat(absolute);
    if (metadata.isDirectory()) {
      result[`${child}/`] = 'directory';
      Object.assign(result, await snapshotTree(root, options, child));
    } else if (metadata.isSymbolicLink()) {
      result[child] = 'symlink';
    } else {
      result[child] = createHash('sha256').update(await readFile(absolute)).digest('hex');
    }
  }
  return result;
}
