import { readProjectFile, writeAtomicFile } from './files.js';

const GITIGNORE_PATH = '.gitignore';
const CODEGRAPH_ENTRY = '.codegraph/';

function hasEffectiveCodeGraphEntry(content) {
  let ignored = false;
  for (const line of content.split(/\r?\n/u)) {
    const rule = line.trim();
    if (rule === CODEGRAPH_ENTRY || rule === `/${CODEGRAPH_ENTRY}`) ignored = true;
    if (rule === `!${CODEGRAPH_ENTRY}` || rule === `!/${CODEGRAPH_ENTRY}`) ignored = false;
  }
  return ignored;
}

export async function ensureCodeGraphIgnored(root) {
  const current = await readProjectFile(root, GITIGNORE_PATH);
  const content = current?.toString('utf8') ?? '';
  if (hasEffectiveCodeGraphEntry(content)) {
    return { relativePath: GITIGNORE_PATH, action: 'skip' };
  }

  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const separator = content.length > 0 && !content.endsWith('\n') ? lineEnding : '';
  await writeAtomicFile(
    root,
    GITIGNORE_PATH,
    `${content}${separator}${CODEGRAPH_ENTRY}${lineEnding}`
  );
  return { relativePath: GITIGNORE_PATH, action: 'write' };
}
