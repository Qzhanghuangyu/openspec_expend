import { FallaError } from '../errors.js';
import { runProcess } from './process.js';
import { selectConfirmation } from './tool-select.js';

const SAFE_ENV_KEYS = [
  'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL',
  'TMPDIR', 'USER', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
];

function restrictedEnvironment(source = process.env) {
  return Object.fromEntries(SAFE_ENV_KEYS
    .filter((key) => typeof source[key] === 'string')
    .map((key) => [key, source[key]]));
}

export async function inspectWebp(options = {}, commandRunner = runProcess) {
  const result = { enabled: options.enabled ?? true, available: false };
  if (!result.enabled) return { ...result, ok: true, state: 'disabled' };
  try {
    await commandRunner('cwebp', ['-version'], {
      env: restrictedEnvironment(options.env),
      stdio: 'ignore',
      timeoutMs: options.timeoutMs ?? 2_000,
      killGraceMs: 100,
    });
    return { ...result, available: true, ok: true, state: 'available' };
  } catch {
    return { ...result, ok: false, state: 'cli-unavailable' };
  }
}

export async function selectWebpInstallation(options = {}) {
  if (options.interactive !== true) return false;
  if ((await inspectWebp(options)).ok) return false;
  const question = '检测到系统未安装 cwebp，是否通过 Homebrew 安装以便优化位图资源？';
  if (options.confirm) return Boolean(await options.confirm(question));
  return selectConfirmation(question, options);
}

export async function installWebp(commandRunner = runProcess, options = {}) {
  const probe = { enabled: true, env: options.env };
  if ((await inspectWebp(probe, commandRunner)).ok) {
    return { success: true, action: 'already-available' };
  }

  const env = restrictedEnvironment(options.env);
  try {
    await commandRunner('brew', ['--version'], {
      env, stdio: 'ignore', timeoutMs: 2_000, killGraceMs: 100,
    });
  } catch {
    throw new FallaError(1, 'Homebrew 不可用，请手动安装 cwebp');
  }
  await commandRunner('brew', ['install', 'webp'], {
    env, stdio: options.stdio ?? 'ignore', killTreeOnTimeout: true,
  });
  if (!(await inspectWebp(probe, commandRunner)).ok) {
    throw new FallaError(1, '安装后未检测到 cwebp');
  }
  return { success: true, action: 'installed' };
}
