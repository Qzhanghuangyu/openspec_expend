#!/usr/bin/env node

import { main } from '../src/cli.js';
import { toSafeError } from '../src/errors.js';

const io = {
  cwd: process.cwd(),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
};
const argv = process.argv.slice(2);
const debug = argv.includes('--debug');
const commandArguments = argv.filter((argument) => argument !== '--debug');

try {
  process.exitCode = await main(commandArguments, io);
} catch (error) {
  const safeError = toSafeError(error);
  io.stderr.write(`${safeError.message}\n`);
  if (debug && typeof error?.stack === 'string') {
    const frames = error.stack.split('\n').slice(1).filter((line) => /^\s*at /.test(line));
    if (frames.length > 0) io.stderr.write(`${frames.join('\n')}\n`);
  }
  process.exitCode = safeError.code;
}
