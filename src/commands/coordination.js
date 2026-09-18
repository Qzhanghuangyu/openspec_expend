import path from 'node:path';

import { FallaError } from '../errors.js';
import { claimChange } from '../coordination/claim.js';
import { validateCoordination } from '../coordination/dag.js';
import {
  registerMapping,
  resolveChange,
  unregisterMapping,
} from '../coordination/resolver.js';
import { assertStatusContract } from '../openspec/contract.js';
import { findProjectRoot } from '../openspec/locator.js';
import { runOpenSpecJson } from '../openspec/runner.js';

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {
    json: false, project: null, change: null, owner: null, positional: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--project' || argument === '--change' || argument === '--owner') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        throw new FallaError(1, `参数 ${argument} 缺少值`);
      }
      const key = argument.slice(2);
      if (options[key] !== null) {
        throw new FallaError(1, `参数不能重复：${argument}`);
      }
      options[key] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) {
      throw new FallaError(1, `未知参数：${argument}`);
    }
    options.positional.push(argument);
  }

  return { command, options };
}

async function resolveRoot(options, io) {
  if (options.project) return path.resolve(io.cwd, options.project);
  return findProjectRoot(io.cwd);
}

function requireSingleReference(command, options) {
  if (options.positional.length !== 1) {
    throw new FallaError(1, `${command} 需要且仅需要一个 change 引用`);
  }
  if (options.change !== null) {
    throw new FallaError(1, `${command} 不接受 --change`);
  }
  return options.positional[0];
}

function rejectOwner(command, options) {
  if (options.owner !== null) throw new FallaError(1, `${command} 不接受 --owner`);
}

function writeResult(io, result, json, summary) {
  io.stdout.write(json ? `${JSON.stringify(result)}\n` : `${summary}\n`);
}

export async function coordinationCommand(argv, io) {
  const { command, options } = parseArguments(argv);
  const root = await resolveRoot(options, io);

  if (command === 'register') {
    rejectOwner(command, options);
    const reference = requireSingleReference(command, options);
    const result = await registerMapping(root, reference);
    writeResult(io, result, options.json, `${result.logical} -> ${result.physical}`);
    return result;
  }

  if (command === 'unregister') {
    rejectOwner(command, options);
    const reference = requireSingleReference(command, options);
    const result = await unregisterMapping(root, reference);
    writeResult(io, result, options.json, `已移除映射：${result.logical}`);
    return result;
  }

  if (command === 'resolve') {
    rejectOwner(command, options);
    const reference = requireSingleReference(command, options);
    const result = await resolveChange(root, reference);
    const output = {
      ...result,
      path: path.relative(root, result.path).split(path.sep).join('/'),
    };
    writeResult(io, output, options.json, `${result.logical} -> ${result.physical} (${result.lifecycle})`);
    return result;
  }

  if (command === 'validate') {
    rejectOwner(command, options);
    if (options.positional.length > 0) {
      throw new FallaError(1, `未知参数：${options.positional[0]}`);
    }
    if (!options.change) {
      throw new FallaError(1, 'validate 需要 --change <parent>');
    }
    const result = await validateCoordination(root, {
      change: options.change,
      statusProvider: async (physical) => assertStatusContract(await runOpenSpecJson(
        ['status', '--change', physical, '--json'],
        {
          cwd: root,
          executable: io.openSpecExecutable ?? 'openspec',
          env: io.env,
        }
      )),
    });
    writeResult(
      io,
      result,
      options.json,
      result.ok
        ? `协调校验通过：${result.parent}`
        : `协调校验失败：${result.parent}（${result.errors.length} 个错误）`
    );
    return result;
  }

  if (command === 'claim') {
    const reference = requireSingleReference(command, options);
    if (!options.owner) throw new FallaError(1, 'claim 需要 --owner <id>');
    const result = await claimChange(root, reference, {
      owner: options.owner,
      statusProvider: async (physical) => assertStatusContract(await runOpenSpecJson(
        ['status', '--change', physical, '--json'],
        {
          cwd: root,
          executable: io.openSpecExecutable ?? 'openspec',
          env: io.env,
        }
      )),
    });
    writeResult(io, result, options.json, `已认领 change：${result.change}`);
    return result;
  }

  throw new FallaError(1, `未知 coordination 子命令：${command ?? ''}`);
}
