import path from 'node:path';
import { FallaError } from '../errors.js';
import { findProjectRoot } from '../openspec/locator.js';
import { prepareCodeGraph } from '../../templates/hooks/falla-codegraph.mjs';

export async function codeGraphCommand(argv, io) {
  const [command, ...args] = argv;
  let project;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') json = true;
    else if (args[index] === '--project' && project === undefined && args[index + 1] && !args[index + 1].startsWith('--')) project = args[++index];
    else throw new FallaError(1, 'CodeGraph 命令参数无效');
  }
  if (command !== 'prepare') throw new FallaError(1, '用法：codegraph prepare [--project <path>] [--json]');
  const root = project ? path.resolve(io.cwd, project) : await findProjectRoot(io.cwd);
  const result = await prepareCodeGraph(root, { env: io.env });
  const ok = !result.enabled || result.ready;
  const summary = !result.enabled ? 'CodeGraph 未启用；保留有界文本检索'
    : result.ready ? 'CodeGraph 本次索引准备完成' : 'CodeGraph 索引准备失败；允许有界文本检索降级';
  io.stdout.write(json ? `${JSON.stringify({ ok, ...result })}\n` : `${summary}\n`);
  return ok ? 0 : 1;
}
