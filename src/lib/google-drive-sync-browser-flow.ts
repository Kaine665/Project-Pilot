/**
 * 在系统浏览器内执行一轮「拉 Drive → 合并 → 取本地 blob → 推 Drive」。
 * - OAuth 回调：不走 Electron 信号。
 * - /oauth/google/browser-sync：`signalElectronDone` 为 true 时通知后端供 Electron 轮询。
 */

import { apiUrl } from '@/lib/api-base';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { parseLenientJson } from '@/lib/json-lenient';
import { refreshAccessToken } from '@/lib/google-oauth-browser';
import { pullFromDrive, pushToDrive, type DriveCredentialsBlob } from '@/lib/google-drive-browser';

export async function runGoogleDriveSyncInBrowser(
  refreshToken: string,
  signalElectronDone = false,
): Promise<void> {
  const accessToken = await refreshAccessToken(refreshToken);

  const remoteBlob = await pullFromDrive(accessToken);
  if (remoteBlob) {
    const mergeRes = await fetchWithRetry(apiUrl('/api/auth/google/sync-merge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ blob: remoteBlob }),
    });
    if (!mergeRes.ok) {
      const t = await mergeRes.text();
      throw new Error(t || `sync-merge failed (${mergeRes.status})`);
    }
  }

  const blobRes = await fetchWithRetry(apiUrl('/api/auth/google/sync-get-blob'), {
    credentials: 'include',
  });
  if (!blobRes.ok) {
    const t = await blobRes.text();
    throw new Error(t || `sync-get-blob failed (${blobRes.status})`);
  }
  const blobBody = await blobRes.text();
  const { blob } = parseLenientJson(blobBody) as { blob?: unknown };
  if (blob && typeof blob === 'object' && (blob as { version?: number }).version === 1) {
    await pushToDrive(accessToken, blob as DriveCredentialsBlob);
  }

  if (signalElectronDone) {
    const doneRes = await fetchWithRetry(apiUrl('/api/auth/google/browser-sync-done'), {
      method: 'POST',
      credentials: 'include',
    });
    if (!doneRes.ok) {
      const t = await doneRes.text();
      throw new Error(t || `browser-sync-done failed (${doneRes.status})`);
    }
  }
}
