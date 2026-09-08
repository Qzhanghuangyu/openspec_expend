import { runProcess } from './process.js';
import { selectConfirmation } from './tool-select.js';

export async function selectLarkCliInstallation(options = {}) {
  if (options.interactive !== true) return false;
  if (options.confirm) return Boolean(await options.confirm('安装并登录 Lark CLI？'));
  return selectConfirmation('安装并登录 Lark CLI？', options);
}

export function installLarkCli(commandRunner = runProcess) {
  return commandRunner('npx', ['@larksuite/cli@latest', 'install']);
}

export function loginLarkCli(commandRunner = runProcess) {
  return commandRunner('lark-cli', ['auth', 'login']);
}
