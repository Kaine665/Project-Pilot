/**
 * api-handler.ts — Next.js API Route 统一错误处理 wrapper。
 *
 * 用法：
 *   import { apiHandler } from '@/lib/api-handler';
 *
 *   export const GET = apiHandler(async (request) => {
 *     // 业务逻辑...
 *     // 验证失败直接 throw new HttpError('...', 400)
 *     // 正常返回 NextResponse
 *     return NextResponse.json(data);
 *   });
 *
 * 效果：
 * - HttpError 会自动转为对应 status code 的 JSON 响应
 * - 未知错误统一返回 500 + 通用错误消息
 * - 减少每个 route 的 try/catch 样板代码
 */

import { NextRequest, NextResponse } from 'next/server';
import { HttpError } from '@/lib/http-error';

type RouteContext = { params: Promise<Record<string, string>> };

/**
 * 包装 Next.js route handler，统一处理错误。
 *
 * 支持两种签名：
 * - `(request: NextRequest) => Promise<NextResponse>`
 * - `(request: NextRequest, ctx: { params }) => Promise<NextResponse>`
 */
export function apiHandler(
  fn: (request: NextRequest, ctx: RouteContext) => Promise<NextResponse>,
) {
  return async (request: NextRequest, ctx: RouteContext): Promise<NextResponse> => {
    try {
      return await fn(request, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(
          { error: err.message, ...(err.code ? { code: err.code } : {}) },
          { status: err.statusCode },
        );
      }

      // 未知错误 → 500，日志输出完整堆栈
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[apiHandler] Unhandled error:', err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
