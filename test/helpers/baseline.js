import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadBaselineState } from '../../src/coordination/baseline-files.js';
import { writeBaselineField } from '../../src/coordination/baseline.js';

/** 仅用于已有验证证据的合法夹具：显式建立当时的快照，不模拟生产的旧记录自动迁移。 */
export async function writeTestBaseline(root, reference) {
  const state = await loadBaselineState(root, reference);
  await writeFile(path.join(state.resolved.path, 'comate.md'), writeBaselineField(state.markdown, state.current));
}
