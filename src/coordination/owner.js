import { FallaError } from '../errors.js';

export function assertOwner(owner) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/u.test(owner) || owner === 'unassigned') {
    throw new FallaError(1, 'owner 必须为 1-64 位字母、数字或 ._@- 字符');
  }
  return owner;
}
