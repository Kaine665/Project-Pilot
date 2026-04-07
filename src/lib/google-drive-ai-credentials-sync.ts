/**
 * Google Drive appDataFolder：同步 AI 供应商 API Key 等可移植凭据（不含 OAuth token 文件路径）。
 */

import { googleExternalFetch } from '@/lib/google-external-fetch';
import type { ClaudeSettings, ProviderCredential, ProviderId } from '@/types';

export const GOOGLE_DRIVE_AI_CREDENTIALS_FILENAME = 'project-pilot-ai-credentials.json';

export interface GoogleDriveAiCredentialsBlob {
  version: 1;
  updatedAt: string;
  providerCredentials?: Partial<Record<ProviderId, ProviderCredential>>;
  providerApiKeys?: Partial<Record<ProviderId, string>>;
  openaiOAuthEnabled?: boolean;
}

export function buildAiCredentialsBlobFromClaude(claude: ClaudeSettings): GoogleDriveAiCredentialsBlob {
  const creds: Partial<Record<ProviderId, ProviderCredential>> = {};
  for (const [k, v] of Object.entries(claude.providerCredentials ?? {})) {
    if (!v || typeof v !== 'object') continue;
    creds[k as ProviderId] = {
      authMode: v.authMode,
      apiKey: v.apiKey,
    };
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    providerCredentials: creds,
    providerApiKeys: claude.providerApiKeys ? { ...claude.providerApiKeys } : undefined,
    openaiOAuthEnabled: claude.openaiOAuthEnabled,
  };
}

function mergeCredential(
  local: ProviderCredential | undefined,
  remote: ProviderCredential | undefined,
): ProviderCredential | undefined {
  if (!remote && !local) return undefined;
  if (!remote) return local;
  if (!local) {
    if (remote.authMode === 'oauth') {
      return { authMode: 'oauth', oauth: remote.oauth };
    }
    return { authMode: remote.authMode ?? 'api_key', apiKey: remote.apiKey };
  }
  const remoteKey = remote.apiKey?.trim();
  const apiKey = remoteKey ? remote.apiKey : local.apiKey;
  const authMode = remote.authMode ?? local.authMode;
  if (authMode === 'oauth') {
    return {
      authMode: 'oauth',
      apiKey: local.apiKey,
      oauth: local.oauth ?? remote.oauth,
      lastVerifiedAt: local.lastVerifiedAt,
    };
  }
  return {
    authMode: 'api_key',
    apiKey,
    lastVerifiedAt: local.lastVerifiedAt,
  };
}

export function mergeRemoteIntoClaude(
  local: ClaudeSettings,
  remote: GoogleDriveAiCredentialsBlob,
): ClaudeSettings {
  const next: ClaudeSettings = { ...local };
  if (remote.openaiOAuthEnabled !== undefined) {
    next.openaiOAuthEnabled = remote.openaiOAuthEnabled;
  }
  const mergedCreds: Partial<Record<ProviderId, ProviderCredential>> = {
    ...(local.providerCredentials ?? {}),
  };
  for (const [k, rv] of Object.entries(remote.providerCredentials ?? {})) {
    if (!rv) continue;
    const pid = k as ProviderId;
    mergedCreds[pid] = mergeCredential(local.providerCredentials?.[pid], rv);
  }
  next.providerCredentials = mergedCreds;

  const mergedFlat: Partial<Record<ProviderId, string>> = { ...(local.providerApiKeys ?? {}) };
  for (const [k, v] of Object.entries(remote.providerApiKeys ?? {})) {
    if (typeof v === 'string' && v.trim()) {
      mergedFlat[k as ProviderId] = v;
    }
  }
  next.providerApiKeys = mergedFlat;
  return next;
}

export function parseDriveBlob(raw: string): GoogleDriveAiCredentialsBlob | null {
  try {
    const j = JSON.parse(raw) as GoogleDriveAiCredentialsBlob;
    if (j?.version !== 1) return null;
    return j;
  } catch {
    return null;
  }
}

async function driveJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Drive HTTP ${res.status}`);
  }
  return JSON.parse(text) as T;
}

export async function findCredentialsFileId(accessToken: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${GOOGLE_DRIVE_AI_CREDENTIALS_FILENAME}' and 'appDataFolder' in parents and trashed=false`,
  );
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`;
  const res = await googleExternalFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await driveJson<{ files?: Array<{ id: string }> }>(res);
  return data.files?.[0]?.id ?? null;
}

export async function createCredentialsFile(accessToken: string): Promise<string> {
  const res = await googleExternalFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: GOOGLE_DRIVE_AI_CREDENTIALS_FILENAME,
      parents: ['appDataFolder'],
    }),
  });
  const data = await driveJson<{ id: string }>(res);
  return data.id;
}

export async function downloadCredentialsFile(accessToken: string, fileId: string): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await googleExternalFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Download HTTP ${res.status}`);
  }
  return res.text();
}

export async function uploadCredentialsFile(
  accessToken: string,
  fileId: string,
  body: string,
): Promise<void> {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`;
  const res = await googleExternalFetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Upload HTTP ${res.status}`);
  }
}

export async function pullAiCredentialsFromDrive(accessToken: string): Promise<GoogleDriveAiCredentialsBlob | null> {
  const id = await findCredentialsFileId(accessToken);
  if (!id) return null;
  const raw = await downloadCredentialsFile(accessToken, id);
  return parseDriveBlob(raw);
}

export async function pushAiCredentialsToDrive(
  accessToken: string,
  blob: GoogleDriveAiCredentialsBlob,
): Promise<void> {
  let id = await findCredentialsFileId(accessToken);
  if (!id) {
    id = await createCredentialsFile(accessToken);
  }
  await uploadCredentialsFile(accessToken, id, JSON.stringify(blob, null, 2));
}
