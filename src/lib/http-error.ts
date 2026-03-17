/**
 * HttpError — 携带 HTTP 状态码的 Error 子类。
 *
 * 在业务逻辑层抛出，由 API route handler 或 sidecar HTTP handler 的 catch 块
 * 根据 statusCode 返回正确的 HTTP 响应码，而非一律 500。
 *
 * @example
 *   throw new HttpError('title is required', 400);
 *   throw new HttpError('Agent not found', 404, 'AGENT_NOT_FOUND');
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    /** 可选的机器可读错误码，如 'VALIDATION_ERROR'、'NOT_FOUND' */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

// ── 常用快捷构造函数 ─────────────────────────────────────────────

/** 400 Bad Request */
export function badRequest(message: string, code?: string): HttpError {
  return new HttpError(message, 400, code ?? 'BAD_REQUEST');
}

/** 404 Not Found */
export function notFound(message: string, code?: string): HttpError {
  return new HttpError(message, 404, code ?? 'NOT_FOUND');
}

/** 405 Method Not Allowed */
export function methodNotAllowed(method: string): HttpError {
  return new HttpError(`Method ${method} not allowed`, 405, 'METHOD_NOT_ALLOWED');
}

/** 409 Conflict */
export function conflict(message: string, code?: string): HttpError {
  return new HttpError(message, 409, code ?? 'CONFLICT');
}
