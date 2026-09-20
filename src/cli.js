import path from 'node:path';

import { FallaError } from './errors.js';
import { coordinationCommand } from './commands/coordination.js';
import { doctorProject } from './commands/doctor.js';
import { installProject } from './commands/install.js';
import { knowledgeCommand } from './commands/knowledge.js';
import { codeGraphCommand } from './commands/codegraph.js';

export function usage() {
  return [
    'Usage: falla-openspec <command> [options] [--debug]',
    '',
    'Commands:',
    '  install <project>                 安装 Falla 工作流扩展',
    '  doctor [project]                  检查 OpenSpec 与 Falla 契约',
    '  coordination register <change>    注册逻辑父子 change 映射',
    '  coordination unregister <change>  清理未落盘的孤儿 change 映射',
    '  coordination resolve <change>     解析逻辑 change 引用',
    '  coordination validate --change X  校验协作依赖图',
    '  coordination claim X --owner ID   排他认领现有 Android change',
    '  ui-knowledge validate             校验项目 Android UI 知识',
    '  ui-knowledge fingerprint <entry>  只读计算知识引用文件指纹',
    '  ui-knowledge index build        使用配置的 Provider 构建完整 RAG 索引',
    '  ui-knowledge index sync         RAG 增量索引契约（尚未实现）',
    '  ui-knowledge index query        RAG 查询契约（尚未实现）',
    '  codegraph prepare                同步当前项目已启用的图谱',
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
    '--with-codegraph': 'boolean',
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
    withCodeGraph: options.with_codegraph,
    withLark: options.with_lark,
    executable: io.openSpecExecutable ?? 'openspec',
    env: io.env,
  });
  writeOutput(
    io,
    report,
    options.json,
    `安装${report.ok ? '完成' : '未完成'}：${report.written.length} 个写入，${report.removed.length} 个清理，${report.warnings.length} 个集成警告；项目健康${report.doctor.ok ? '通过' : '存在问题，请运行 doctor --json'}`
  );
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

export async function main(argv, io) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === 'install') return install(rest, io);
  if (command === 'doctor') return doctor(rest, io);
  if (command === 'ui-knowledge') return knowledgeCommand(rest, io);
  if (command === 'codegraph') return codeGraphCommand(rest, io);
  if (command === 'coordination') {
    const result = await coordinationCommand(rest, io);
    return result.ok === false ? 1 : 0;
  }
  throw new FallaError(1, `未知命令：${command}`);
}
