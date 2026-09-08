export class FallaError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'FallaError';
    this.code = code;
    this.details = details;
  }
}

export function toSafeError(error) {
  if (error instanceof FallaError) return error;
  return new FallaError(1, '操作失败；使用 --debug 查看本地诊断信息');
}
