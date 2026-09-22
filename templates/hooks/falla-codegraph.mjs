import { spawn } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const MANIFEST = path.join('.falla', 'install-manifest.json');
const MAX_MANIFEST_BYTES = 1024 * 1024;

async function safeLstat(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function restrictedEnvironment(source = process.env) {
  const allowed = [
    'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL',
    'TMPDIR', 'USER', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  ];
  return Object.fromEntries(allowed
    .filter((key) => typeof source[key] === 'string')
    .map((key) => [key, source[key]]));
}

async function codeGraphEnabled(root) {
  const directory = await safeLstat(path.join(root, '.falla'));
  if (!directory || directory.isSymbolicLink() || !directory.isDirectory()) return false;
  const manifestPath = path.join(root, MANIFEST);
  const entry = await safeLstat(manifestPath);
  if (!entry || entry.isSymbolicLink() || !entry.isFile() || entry.size > MAX_MANIFEST_BYTES) {
    return false;
  }
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    return manifest?.formatVersion === 3 && manifest?.integrations?.codegraph === true;
  } catch {
    return false;
  }
}

function runCodeGraph(args, root, timeoutMs, env) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let timer;
    let killTimer;
    const child = spawn('codegraph', args, {
      cwd: root,
      env: restrictedEnvironment(env),
      shell: false,
      stdio: 'ignore',
    });
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve(ok);
    };
    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(!timedOut && code === 0));
    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 1_000);
    }, timeoutMs);
  });
}

export async function prepareCodeGraph(root, options = {}) {
  if (!await codeGraphEnabled(root)) return { enabled: false, ready: false };

  const projectRoot = await realpath(root);
  const indexPath = path.join(projectRoot, '.codegraph');
  const entry = await safeLstat(indexPath);
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) {
    return { enabled: true, ready: false, reasonCode: 'unsafe-index-path' };
  }

  const action = entry ? 'sync' : 'init';
  const args = action === 'init'
    ? ['init', projectRoot]
    : ['sync', projectRoot, '--quiet'];
  const ready = await runCodeGraph(args, projectRoot, options.timeoutMs ?? 60_000, options.env);
  return {
    enabled: true,
    ready,
    action,
    ...(ready ? {} : { reasonCode: 'command-failed' }),
  };
}

export function codeGraphContext(result) {
  if (!result.enabled) return null;
  if (!result.ready) {
    return '【CodeGraph】本次索引准备失败；允许降级为有界 rg/find，禁止全仓无界读取或输出原始错误。';
  }
  return '【CodeGraph】项目索引已准备完成。已知准确符号、路径、资源或文本时优先使用有界 rg/直接读取；未知入口或需要调用链、继承实现、生命周期、影响面和受影响测试时使用 CodeGraph。修改公共符号前必须检查影响面，不要求每个任务机械地同时使用两种工具。';
}
