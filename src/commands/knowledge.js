import path from 'node:path';
import { FallaError } from '../errors.js';
import { findProjectRoot } from '../openspec/locator.js';
import { validateKnowledge, fingerprintEntry } from '../knowledge/validate.js';
import { knowledgeIndexCommand } from './knowledge-index.js';

export async function knowledgeCommand(argv, io) {
  const [command, ...args] = argv;
  if (command === 'index') return knowledgeIndexCommand(args, io);
  const positional = [];
  let project;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--project' && project === undefined && args[index + 1] && !args[index + 1].startsWith('--')) project = args[++index];
    else if (arg.startsWith('-')) throw new FallaError(1, 'UI 知识命令参数无效');
    else positional.push(arg);
  }
  if (!['validate', 'fingerprint'].includes(command)
    || positional.length !== (command === 'fingerprint' ? 1 : 0)) {
    throw new FallaError(1, '用法：ui-knowledge validate 或 ui-knowledge fingerprint <entry> [--project <path>] [--json]');
  }
  const root = project ? path.resolve(io.cwd, project) : await findProjectRoot(io.cwd);
  const result = command === 'validate' ? await validateKnowledge(root) : await fingerprintEntry(root, positional[0]);
  const summary = command === 'validate'
    ? `UI 知识校验${result.ok ? '通过' : '失败'}：${result.entries.length} 个条目，${result.errors.length} 个错误；仅验证结构与文件指纹，直接复用仍需核对 CodeGraph、依赖和生命周期`
    : '文件指纹已读取；不会自动写回或授予 verified 状态';
  io.stdout.write(json || command === 'fingerprint' ? `${JSON.stringify(result)}\n` : `${summary}\n`);
  return result.ok === false ? 1 : 0;
}
