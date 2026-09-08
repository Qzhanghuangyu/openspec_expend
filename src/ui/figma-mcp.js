import { FallaError } from '../errors.js';
import { runProcess } from './process.js';
import { selectConfirmation } from './tool-select.js';

const FIGMA_MCP_COMMANDS = {
  codex: {
    command: 'codex',
    args: ['mcp', 'add', 'figma', '--url', 'https://mcp.figma.com/mcp'],
  },
  claude: {
    command: 'claude',
    args: ['plugin', 'install', 'figma@claude-plugins-official'],
  },
};

export async function selectFigmaMcpInstallation(options = {}) {
  if (options.interactive !== true) return false;
  if (options.confirm) return Boolean(await options.confirm('安装 Figma MCP？'));
  return selectConfirmation('安装 Figma MCP？', options);
}

export async function installFigmaMcp(toolIds, commandRunner = runProcess) {
  const results = [];
  for (const toolId of toolIds) {
    const config = FIGMA_MCP_COMMANDS[toolId];
    if (!config) throw new FallaError(1, `不支持的 Agent 工具：${toolId}`);
    try {
      await commandRunner(config.command, [...config.args]);
      results.push({ toolId, success: true });
    } catch {
      results.push({ toolId, success: false });
    }
  }
  return results;
}
