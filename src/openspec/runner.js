import { execFile } from 'node:child_process';

import { FallaError } from '../errors.js';

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export function runOpenSpec(args, options = {}) {
  const executable = options.executable ?? 'openspec';
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      {
        cwd,
        env: options.env ?? process.env,
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout,
      },
      (error, stdout, stderr) => {
        options.signal?.removeEventListener('abort', abort);
        if (error) {
          reject(new FallaError(1, 'OpenSpec 命令执行失败', {
            exitCode: typeof error.code === 'number' ? error.code : 1,
            signal: error.signal ?? null,
            timedOut: Boolean(error.killed),
          }));
          return;
        }
        resolve({ stdout, stderr, exitCode: 0 });
      }
    );

    const abort = () => child.kill('SIGTERM');
    if (options.signal?.aborted) {
      abort();
    } else {
      options.signal?.addEventListener('abort', abort, { once: true });
    }
  });
}

export async function runOpenSpecJson(args, options = {}) {
  const result = await runOpenSpec(args, options);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new FallaError(3, 'OpenSpec 返回了无法解析的 JSON');
  }
}
