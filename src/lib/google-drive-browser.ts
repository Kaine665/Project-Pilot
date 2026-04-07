/**
 * Browser-side Google Drive appData operations.
 * Uses plain browser fetch (which has working VPN) instead of backend fetch.
 */

const CREDENTIALS_FILENAME = 'project-pilot-ai-credentials.json';

async function driveJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Drive HTTP ${res.status}`);
  }
  return JSON.parse(text) as T;
}

export async function findCredentialsFileId(accessToken: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${CREDENTIALS_FILENAME}' and 'appDataFolder' in parents and trashed=false`,
  );
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await driveJson<{ files?: Array<{ id: string }> }>(res);
  return data.files?.[0]?.id ?? null;
}

async function createCredentialsFile(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: CREDENTIALS_FILENAME,
      parents: ['appDataFolder'],
    }),
  });
  const data = await driveJson<{ id: string }>(res);
  return data.id;
}

async function downloadCredentialsFile(accessToken: string, fileId: string): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Download HTTP ${res.status}`);
  }
  return res.text();
}

async function uploadCredentialsFile(
  accessToken: string,
  fileId: string,
  body: string,
): Promise<void> {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`;
  const res = await fetch(url, {
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

export interface DriveCredentialsBlob {
  version: 1;
  updatedAt: string;
  providerCredentials?: Record<string, unknown>;
  providerApiKeys?: Record<string, string>;
  openaiOAuthEnabled?: boolean;
}

function parseDriveBlob(raw: string): DriveCredentialsBlob | null {
  try {
    const j = JSON.parse(raw) as DriveCredentialsBlob;
    if (j?.version !== 1) return null;
    return j;
  } catch {
    return null;
  }
}

export async function pullFromDrive(accessToken: string): Promise<DriveCredentialsBlob | null> {
  const id = await findCredentialsFileId(accessToken);
  if (!id) return null;
  const raw = await downloadCredentialsFile(accessToken, id);
  return parseDriveBlob(raw);
}

export async function pushToDrive(accessToken: string, blob: DriveCredentialsBlob): Promise<void> {
  let id = await findCredentialsFileId(accessToken);
  if (!id) {
    id = await createCredentialsFile(accessToken);
  }
  await uploadCredentialsFile(accessToken, id, JSON.stringify(blob, null, 2));
}
