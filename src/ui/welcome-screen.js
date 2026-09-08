import { FallaError } from '../errors.js';

const FRAMES = [
  ['      ●      ', '   ╭─────╮   ', '   │  ◆  │   ', '   ╰─────╯   '],
  ['             ', '   ╭──●──╮   ', '   │  ◆  │   ', '   ╰─────╯   '],
  ['             ', '   ╭─────╮   ', '   │  ◆  ●   ', '   ╰─────╯   '],
  ['             ', '   ╭─────╮   ', '   │  ◆  │   ', '   ╰──●──╯   '],
];

function render(frame) {
  return `${frame.join('\n')}\nWelcome to FallaOpenSpec\n官方 OpenSpec 内核 + Falla 协作能力\n`;
}

export async function showWelcomeScreen(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const env = options.env ?? process.env;
  const interactive = options.interactive === true && stdin.isTTY && stdout.isTTY;
  if (!interactive) {
    stdout.write(`${render(FRAMES.at(-1))}\n`);
    return;
  }

  const setIntervalFn = options.setInterval ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? clearInterval;
  const previousRaw = Boolean(stdin.isRaw);
  let frame = 0;
  let timer;
  return new Promise((resolve, reject) => {
    const paint = () => {
      stdout.write(`${render(FRAMES[frame])}\n按 Enter 继续…\n`);
      frame = (frame + 1) % FRAMES.length;
    };
    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (timer !== undefined) clearIntervalFn(timer);
      stdin.setRawMode?.(previousRaw);
      stdin.pause?.();
    };
    const onData = (data) => {
      const key = data.toString();
      if (key !== '\r' && key !== '\n' && key !== '\u0003') return;
      cleanup();
      if (key === '\u0003') reject(new FallaError(1, '安装已取消'));
      else resolve();
    };

    stdin.setRawMode?.(true);
    stdin.resume?.();
    stdin.on('data', onData);
    paint();
    if (!env.NO_COLOR && (stdout.columns ?? 80) >= 60) {
      timer = setIntervalFn(paint, 120);
    }
  });
}
