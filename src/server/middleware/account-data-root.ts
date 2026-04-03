/**
 * 按 Google 登录会话将 API 请求绑定到 ~/.project-pilot/accounts/<sub>/ 数据根；
 * 未登录时使用物理根（与历史行为一致）。
 */
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import {
  ensureDataDirV2Migrated,
  getBaseDataDir,
  runWithDataDir,
} from '@/lib/file-store';
import {
  COOKIE_NAME,
  getGoogleAccountDataRoot,
  verifySessionToken,
  type GoogleAccountJwtPayload,
} from '@/lib/google-account-auth';
import { ensureManagersAlignedWithDataRoot } from '@/lib/data-root-managers';

export type AccountVariables = {
  ppUser: GoogleAccountJwtPayload | null;
  ppDataRoot: string;
};

export const accountDataRootMiddleware = createMiddleware<{ Variables: AccountVariables }>(
  async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    let user: GoogleAccountJwtPayload | null = null;
    if (token) {
      user = await verifySessionToken(token);
    }

    const root = user ? getGoogleAccountDataRoot(user.sub) : getBaseDataDir();
    c.set('ppUser', user);
    c.set('ppDataRoot', root);

    await ensureManagersAlignedWithDataRoot(root);

    return runWithDataDir(root, async () => {
      await ensureDataDirV2Migrated();
      await next();
    });
  },
);
