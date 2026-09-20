import path from 'node:path';

import { FallaError } from '../errors.js';
import { findProjectRoot } from '../openspec/locator.js';
import {
  DEFAULT_TOP_K,
  INDEX_ACTIONS,
  MAX_TOP_K,
  indexContractSummary,
} from '../knowledge/index/contract.js';

const USAGE = [
  '用法：',
  '  ui-knowledge index build [--project <path>] [--json]',
  '  ui-knowledge index sync [--project <path>] [--json]',
  '  ui-knowledge index rebuild [--project <path>] [--json]',
  '  ui-knowledge index status [--project <path>] [--json]',
  '  ui-knowledge index clear [--project <path>] [--json]',
  '  ui-knowledge index query --text <query> [--top-k <1..50>] [--project <path>] [--json]',
].join('\n');

function usageError() {
  return new FallaError(1, USAGE);
}

function parsePositiveInteger(value, max) {
  if (!/^[1-9]\d*$/u.test(String(value))) throw usageError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw usageError();
  return parsed;
}

export async function knowledgeIndexCommand(argv, io) {
  const [action, ...args] = argv;
  if (!INDEX_ACTIONS.includes(action)) throw usageError();

  let project;
  let json = false;
  let text;
  let topK = DEFAULT_TOP_K;
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      if (json) throw usageError();
      json = true;
    } else if (argument === '--project') {
      if (project !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw usageError();
      project = args[++index];
    } else if (argument === '--text') {
      if (text !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw usageError();
      text = args[++index];
    } else if (argument === '--top-k') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw usageError();
      topK = parsePositiveInteger(args[++index], MAX_TOP_K);
    } else if (argument.startsWith('-')) {
      throw usageError();
    } else {
      positional.push(argument);
    }
  }

  if (positional.length > 0) throw usageError();
  if (action === 'query') {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw usageError();
  } else if (text !== undefined || topK !== DEFAULT_TOP_K) {
    throw usageError();
  }

  const root = project ? path.resolve(io.cwd, project) : await findProjectRoot(io.cwd);
  // Resolve the project now so the future implementation cannot silently change project-boundary semantics.
  void root;

  const result = {
    ok: false,
    implemented: false,
    action,
    ...(action === 'query' ? { request: { text: text.trim(), topK } } : {}),
    contract: indexContractSummary(),
  };
  const message = `UI 知识索引命令契约已定义但尚未实现：${action}`;
  io.stdout.write(json ? `${JSON.stringify(result)}\n` : `${message}\n`);
  return 1;
}
