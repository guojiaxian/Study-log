/** 统一业务错误类型（错误码表见开发手册 5.1） */
export class AppError extends Error {
  constructor(code, message, httpStatus = 500, data = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.data = data;
  }
}

export const Err = {
  validation: (message = '参数校验失败', data = null) => new AppError(1001, message, 400, data),
  notFound: (message = '资源不存在') => new AppError(2001, message, 404),
  conflict: (message = '资源冲突', data = null) => new AppError(2002, message, 409, data),
  constraint: (message = '数据约束不满足', data = null) => new AppError(2003, message, 422, data),
  aiUnavailable: (message = 'AI 服务不可用 / 超时') => new AppError(3001, message, 502),
  aiParse: (message = 'AI 返回内容无法解析为合法结构', data = null) => new AppError(3002, message, 502, data),
  aiQuota: (message = 'AI 额度或鉴权异常') => new AppError(3003, message, 502),
  internal: (message = '服务器内部错误') => new AppError(5000, message, 500),
};

export function ok(data = {}) {
  return { code: 0, message: 'ok', data };
}
