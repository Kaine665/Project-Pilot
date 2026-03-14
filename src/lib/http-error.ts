/**
 * HttpError — 携带 HTTP 状态码的 Error 子类。
 *
 * 在业务逻辑层抛出，由 sidecar HTTP handler 的 catch 块
 * 根据 statusCode 返回正确的 HTTP 响应码，而非一律 500。
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
