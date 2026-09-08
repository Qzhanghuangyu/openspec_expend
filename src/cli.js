import path from 'node:path';

import { FallaError } from './errors.js';
import { coordinationCommand } from './commands/coordination.js';
import { doctorProject } from './commands/doctor.js';
import { installProject } from './commands/install.js';
import { migrateProject } from './commands/migrate.js';
import { renderMigrationReport } from './migration/report.js';

export function usage() {
  return [
    'Usage: falla-openspec <command> [options] [--debug]',
    '',
    'Commands:',
    '  install <project>                 安装 Falla 工作流扩展',
    '  doctor [project]                  检查 OpenSpec 与 Falla 契约',
    '  migrate <project>                 预览或执行旧项目迁移',
    '  coordination register <change>    注册逻辑父子 change 映射',
    '  coordination resolve <change>     解析逻辑 change 引用',
    '  coordination validate --change X  校验协作依赖图',
  ].join('\n');
}

function parseOptions(argv, specification) {
  const result = { positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const option = specification[argument];
    if (!option) {
      if (argument.startsWith('-')) throw new FallaError(1, `未知参数：${argument}`);
      result.positional.push(argument);
      continue;
    }
    if (option === 'boolean') {
      result[argument.slice(2).replaceAll('-', '_')] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new FallaError(1, `参数 ${argument} 缺少值`);
    const key = argument.slice(2).replaceAll('-', '_');
    if (result[key] !== undefined) throw new FallaError(1, `参数不能重复：${argument}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function requireProject(options, cwd, required = false) {
  if (options.positional.length > 1 || (required && options.positional.length !== 1)) {
    throw new FallaError(1, required ? '命令需要且仅需要一个项目路径' : '命令最多接受一个项目路径');
  }
  return path.resolve(cwd, options.positional[0] ?? '.');
}

function writeOutput(io, value, json, human) {
  io.stdout.write(json ? `${JSON.stringify(value)}\n` : `${human}\n`);
}

async function install(argv, io) {
  const options = parseOptions(argv, {
    '--tools': 'value',
    '--with-figma': 'boolean',
    '--with-lark': 'boolean',
    '--non-interactive': 'boolean',
    '--json': 'boolean',
  });
  const root = requireProject(options, io.cwd);
  const tools = options.tools?.split(',').map((tool) => tool.trim()).filter(Boolean);
  const report = await installProject({
    root,
    tools,
    interactive: options.non_interactive !== true && Boolean(io.stdin?.isTTY && io.stdout?.isTTY),
    withFigma: options.with_figma,
    withLark: options.with_lark,
    executable: io.openSpecExecutable ?? 'openspec',
    env: io.env,
  });
  writeOutput(io, report, options.json, `安装完成：${report.written.length} 个写入，${report.warnings.length} 个警告`);
  return report.ok ? 0 : 1;
}

async function doctor(argv, io) {
  const options = parseOptions(argv, { '--json': 'boolean' });
  const root = requireProject(options, io.cwd);
  const report = await doctorProject({
    root,
    executable: io.openSpecExecutable ?? 'openspec',
    env: io.env,
  });
  writeOutput(io, report, options.json, report.ok ? 'doctor 检查通过' : 'doctor 检查未通过');
  return report.ok ? 0 : 1;
}

async function migrate(argv, io) {
  const options = parseOptions(argv, {
    '--apply': 'boolean',
    '--rollback': 'value',
    '--json': 'boolean',
  });
  const root = requireProject(options, io.cwd, true);
  if (options.apply && options.rollback) {
    throw new FallaError(1, '--apply 与 --rollback 不能同时使用');
  }
  const result = await migrateProject({
    root,
    apply: options.apply === true,
    rollback: options.rollback,
    executable: io.openSpecExecutable ?? 'openspec',
    env: io.env,
  });
  const output = options.apply || options.rollback ? result : renderMigrationReport(result);
  const human = options.rollback
    ? `迁移已回滚：${result.id}`
    : options.apply
      ? `迁移完成：${result.id}`
      : `dry-run：${output.counts.conflict} 个冲突`;
  writeOutput(io, output, options.json, human);
  return 0;
}

export async function main(argv, io) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === 'install') return install(rest, io);
  if (command === 'doctor') return doctor(rest, io);
  if (command === 'migrate') return migrate(rest, io);
  if (command === 'coordination') {
    const result = await coordinationCommand(rest, io);
    return result.ok === false ? 1 : 0;
  }
  throw new FallaError(1, `未知命令：${command}`);
}
