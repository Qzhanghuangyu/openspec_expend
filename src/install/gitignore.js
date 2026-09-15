import { readProjectFile, writeAtomicFile } from './files.js';

const GITIGNORE_PATH = '.gitignore';
const LOCAL_INDEX_ENTRIES = [
  '.codegraph/',
  '.falla/ui-knowledge/.index/',
];

function isEffectivelyIgnored(content, entry) {
  let ignored = false;
  for (const line of content.split(/\r?\n/u)) {
    const rule = line.trim();
    if (rule === entry || rule === `/${entry}`) ignored = true;
    if (rule === `!${entry}` || rule === `!/${entry}`) ignored = false;
  }
  return ignored;
}

export async function ensureLocalIndexesIgnored(root) {
  const current = await readProjectFile(root, GITIGNORE_PATH);
  const content = current?.toString('utf8') ?? '';
  const missing = LOCAL_INDEX_ENTRIES.filter((entry) => !isEffectivelyIgnored(content, entry));
  if (missing.length === 0) {
    return { relativePath: GITIGNORE_PATH, action: 'skip' };
  }

  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const separator = content.length > 0 && !content.endsWith('\n') ? lineEnding : '';
  await writeAtomicFile(
    root,
    GITIGNORE_PATH,
    `${content}${separator}${missing.join(lineEnding)}${lineEnding}`
  );
  return { relativePath: GITIGNORE_PATH, action: 'write' };
}

export const ensureCodeGraphIgnored = ensureLocalIndexesIgnored;
