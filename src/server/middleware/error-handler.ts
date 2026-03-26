/**
 * API error handler middleware for Hono.
 * Catches errors thrown by route handlers and returns consistent JSON responses.
 */
import type { Context, Next } from 'hono';
import { HttpError } from '@/lib/http-error';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    console.error('[api-error]', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return c.json({ error: message }, 500);
  }
}
