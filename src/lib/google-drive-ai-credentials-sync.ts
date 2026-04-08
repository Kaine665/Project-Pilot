/**
 * AI credential blob helpers — build & merge logic for Google Drive sync.
 *
 * All Google Drive API calls now happen in the browser (src/lib/google-drive-browser.ts).
 * This file only contains pure data transformation functions used by the backend.
 */

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
