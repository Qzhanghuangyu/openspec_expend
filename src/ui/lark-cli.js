import { FallaError } from '../errors.js';
import { runProcess } from './process.js';
import { selectConfirmation } from './tool-select.js';

const LARK_DOMAINS = new Set([
  'application', 'approval', 'apps', 'attendance', 'base', 'calendar', 'contact',
  'docs', 'drive', 'event', 'im', 'mail', 'markdown', 'mindnotes', 'minutes',
  'note', 'okr', 'sheets', 'slides', 'task', 'vc', 'wiki',
]);

export async function selectLarkCliInstallation(options = {}) {
  if (options.interactive !== true) return false;
  if (options.confirm) return Boolean(await options.confirm('安装 Lark CLI（不自动申请权限）？'));
  return selectConfirmation('安装 Lark CLI（不自动申请权限）？', options);
}

export function installLarkCli(commandRunner = runProcess) {
  return commandRunner('npm', ['install', '--global', '@larksuite/cli@latest']);
}

export function loginLarkCli(domains, commandRunner = runProcess) {
  const selected = [...new Set(domains ?? [])];
  if (selected.length === 0 || selected.some((domain) => !LARK_DOMAINS.has(domain))) {
    throw new FallaError(1, 'Lark 登录必须显式指定受支持的最小业务域');
  }
  return commandRunner('lark-cli', [
    'auth', 'login', '--domain', selected.join(','), '--no-wait', '--json',
  ]);
}
