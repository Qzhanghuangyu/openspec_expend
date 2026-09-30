import path from 'node:path';

import { FallaError } from '../errors.js';
import { claimChange } from '../coordination/claim.js';
import { transitionParent, transferParent } from '../coordination/parent-lifecycle.js';
import { validateCoordination } from '../coordination/dag.js';
import { checkPreflight } from '../coordination/health.js';
import { inspectBaseline } from '../coordination/baseline-files.js';
import { recordBaseline } from '../coordination/baseline-store.js';
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
    json: false, record: false, coordinator: false, project: null, change: null, owner: null, status: null, to: null, positional: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--coordinator') {
      if (command !== 'claim' || options.coordinator) throw new FallaError(1, '仅 claim 接受单个 --coordinator');
      options.coordinator = true;
      continue;
    }
    if (argument === '--record') {
      if (command !== 'baseline' || options.record) throw new FallaError(1, '仅 baseline 接受单个 --record');
      options.record = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (['--project', '--change', '--owner', '--status', '--to'].includes(argument)) {
      if (argument === '--status' && command !== 'transition') throw new FallaError(1, '仅 transition 接受 --status');
      if (argument === '--to' && command !== 'transfer') throw new FallaError(1, '仅 transfer 接受 --to');
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

  if (command === 'baseline') {
    const reference = requireSingleReference(command, options);
    if (!options.record) rejectOwner(command, options);
    if (options.record && !options.owner) throw new FallaError(1, 'baseline --record 需要 --owner <id>');
    const result = options.record
      ? await recordBaseline(root, reference, { owner: options.owner })
      : await inspectBaseline(root, reference);
    writeResult(io, result, options.json, result.ok
      ? `实施基线已核对：${result.change}`
      : `实施基线需复核：${result.change}；请核对当前基线与受影响任务`);
    return result;
  }

  if (command === 'preflight') {
    rejectOwner(command, options);
    const reference = requireSingleReference(command, options);
    const result = await checkPreflight(root, reference);
    writeResult(io, result, options.json, result.ok
      ? `Preflight 准入通过：${result.parent}`
      : `Preflight 准入未通过：${result.parent}；请核对 preflight.md 的阻塞项和确认依据`);
    return result;
  }

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

  if (command === 'transition' || command === 'transfer') {
    const reference = requireSingleReference(command, options);
    if (!options.owner) throw new FallaError(1, `${command} 需要 --owner <id>`);
    if (command === 'transition' && !options.status) throw new FallaError(1, 'transition 需要 --status <status>');
    if (command === 'transfer' && !options.to) throw new FallaError(1, 'transfer 需要 --to <id>');
    const operation = command === 'transition' ? transitionParent : transferParent;
    const result = await operation(root, reference, {
      owner: options.owner, status: options.status, to: options.to,
      statusProvider: async physical => assertStatusContract(await runOpenSpecJson(
        ['status', '--change', physical, '--json'],
        { cwd: root, executable: io.openSpecExecutable ?? 'openspec', env: io.env }
      )),
    });
    writeResult(io, result, options.json, command === 'transition'
      ? `父协调状态已核对：${result.change}（${result.status}）`
      : `父协调职责已交接：${result.change}`);
    return result;
  }

  if (command === 'claim') {
    const reference = requireSingleReference(command, options);
    if (!options.owner) throw new FallaError(1, 'claim 需要 --owner <id>');
    const result = await claimChange(root, reference, {
      owner: options.owner, coordinator: options.coordinator,
      statusProvider: async (physical) => assertStatusContract(await runOpenSpecJson(
        ['status', '--change', physical, '--json'],
        {
          cwd: root,
          executable: io.openSpecExecutable ?? 'openspec',
          env: io.env,
        }
      )),
    });
    writeResult(io, result, options.json, `${result.role === 'coordinator' ? '已认领父协调职责' : '已认领 change'}：${result.change}`);
    return result;
  }

  throw new FallaError(1, `未知 coordination 子命令：${command ?? ''}`);
}
