import { FallaError } from '../errors.js';

function restoreInput(stdin, previousRaw) {
  stdin.setRawMode?.(previousRaw);
  stdin.pause?.();
}

export async function selectTools(tools, options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  if (options.interactive !== true || !stdin.isTTY || !stdout.isTTY) {
    return tools.map(({ id }) => id);
  }

  let cursor = 0;
  const selected = new Set(tools.map(({ id }) => id));
  const previousRaw = Boolean(stdin.isRaw);
  return new Promise((resolve, reject) => {
    const render = () => {
      const rows = tools.map((tool, index) => {
        const pointer = index === cursor ? '›' : ' ';
        const checked = selected.has(tool.id) ? '◉' : '○';
        return `${pointer} ${checked} ${tool.name}`;
      });
      stdout.write(`选择要安装 Skill 的工具：\n${rows.join('\n')}\n`);
    };
    const cleanup = () => {
      stdin.removeListener('data', onData);
      restoreInput(stdin, previousRaw);
    };
    const onData = (data) => {
      const key = data.toString();
      if (key === '\u0003') {
        cleanup();
        reject(new FallaError(1, '安装已取消'));
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(tools.filter(({ id }) => selected.has(id)).map(({ id }) => id));
        return;
      }
      if (key === ' ' && tools[cursor]) {
        const id = tools[cursor].id;
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      } else if (key === '\u001b[A') {
        cursor = Math.max(0, cursor - 1);
      } else if (key === '\u001b[B') {
        cursor = Math.min(tools.length - 1, cursor + 1);
      }
      render();
    };

    stdin.setRawMode?.(true);
    stdin.resume?.();
    stdin.on('data', onData);
    render();
  });
}

export async function selectConfirmation(question, options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  if (options.interactive !== true || !stdin.isTTY || !stdout.isTTY) return false;

  let cursor = 0;
  const values = [true, false];
  const previousRaw = Boolean(stdin.isRaw);
  return new Promise((resolve, reject) => {
    const render = () => {
      stdout.write(`${question}\n${cursor === 0 ? '›' : ' '} 是\n${cursor === 1 ? '›' : ' '} 否\n`);
    };
    const cleanup = () => {
      stdin.removeListener('data', onData);
      restoreInput(stdin, previousRaw);
    };
    const onData = (data) => {
      const key = data.toString();
      if (key === '\u0003') {
        cleanup();
        reject(new FallaError(1, '安装已取消'));
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(values[cursor]);
        return;
      }
      if (key === '\u001b[A') cursor = Math.max(0, cursor - 1);
      if (key === '\u001b[B') cursor = Math.min(1, cursor + 1);
      render();
    };

    stdin.setRawMode?.(true);
    stdin.resume?.();
    stdin.on('data', onData);
    render();
  });
}
