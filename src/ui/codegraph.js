import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { FallaError } from '../errors.js';
import { runProcess } from './process.js';
import { selectConfirmation } from './tool-select.js';

const TOOL_IDS = new Set(['claude', 'codex']);

function restrictedEnvironment(source = process.env) {
  const allowed = [
    'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL',
    'TMPDIR', 'USER', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  ];
  return Object.fromEntries(allowed
    .filter((key) => typeof source[key] === 'string')
    .map((key) => [key, source[key]]));
}

async function indexState(root) {
  try {
    const entry = await lstat(path.join(root, '.codegraph'));
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new FallaError(1, '.codegraph 必须是项目内真实目录，不能是符号链接');
    }
    return 'sync';
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'init';
    throw error;
  }
}

export async function selectCodeGraphInstallation(options = {}) {
  if (options.interactive !== true) return false;
  if (options.confirm) return Boolean(await options.confirm('安装 CodeGraph 并初始化项目索引？'));
  return selectConfirmation('安装 CodeGraph 并初始化项目索引？', options);
}

export async function installCodeGraph(toolIds, root, commandRunner = runProcess, options = {}) {
  const tools = [...new Set(toolIds)];
  if (tools.length === 0 || tools.some((toolId) => !TOOL_IDS.has(toolId))) {
    throw new FallaError(1, 'CodeGraph 需要至少一个受支持的 Agent 工具');
  }

  const action = await indexState(root);
  const processOptions = {
    env: restrictedEnvironment(options.env),
    stdio: options.stdio ?? 'ignore',
  };
  await commandRunner('codegraph', [
    'install',
    '--target', tools.join(','),
    '--location', 'global',
    '--yes',
    '--no-permissions',
  ], processOptions);

  const args = action === 'init' ? ['init', root] : ['sync', root, '--quiet'];
  await commandRunner('codegraph', args, { ...processOptions, cwd: root });
  return { success: true, action, tools };
}

export async function inspectCodeGraph(root, options = {}) {
  const result = {
    enabled: options.enabled === true, available: false, indexPresent: false,
    freshness: 'not-checked', connection: 'not-checked',
  };
  if (!result.enabled) return { ...result, ok: true, state: 'disabled' };
  try {
    await runProcess('codegraph', ['--version'], {
      cwd: root, env: restrictedEnvironment(options.env), stdio: 'ignore',
      timeoutMs: options.timeoutMs ?? 2_000, killGraceMs: 100,
    });
    result.available = true;
  } catch {
    // No raw subprocess diagnostics or environment values in health reports.
  }
  let unsafe = false;
  try {
    const directory = await lstat(path.join(root, '.codegraph'));
    unsafe = directory.isSymbolicLink() || !directory.isDirectory();
    if (!unsafe) {
      const file = await lstat(path.join(root, '.codegraph/codegraph.db'));
      unsafe = file.isSymbolicLink() || !file.isFile();
      result.indexPresent = !unsafe;
    }
  } catch {
    result.indexPresent = false;
  }
  return {
    ...result, ok: result.available && result.indexPresent && !unsafe,
    state: unsafe ? 'unsafe-index-path' : !result.available ? 'cli-unavailable'
      : !result.indexPresent ? 'index-missing' : 'available',
  };
}
