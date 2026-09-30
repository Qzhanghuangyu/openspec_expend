import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// 仅供不测试需求准入的既有夹具使用：显式提供已经核对、没有阻塞项的前置条件。
export async function writeReviewedPreflight(directory) {
  await writeFile(path.join(directory, 'preflight.md'),
    '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\n---\n# Preflight\n已核对，无阻塞项。\n');
}
