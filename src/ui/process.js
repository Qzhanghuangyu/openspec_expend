import { spawn } from 'node:child_process';

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timer;
    let killTimer;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      shell: false,
    });

    const cleanup = () => {
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (timer !== undefined) clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(timedOut ? '外部工具执行超时，已终止' : '外部工具无法启动'));
    };
    const onExit = (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timedOut) {
        reject(new Error('外部工具执行超时，已终止'));
      } else if (code === 0) {
        resolve({ code: 0 });
      } else {
        reject(new Error(`外部工具执行失败（code=${code ?? 'null'}, signal=${signal ?? 'none'}）`));
      }
    };

    child.once('error', onError);
    child.once('exit', onExit);
    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, options.killGraceMs ?? 1_000);
    }, options.timeoutMs ?? 5 * 60_000);
  });
}
