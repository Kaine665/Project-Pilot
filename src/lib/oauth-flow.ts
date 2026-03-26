/**
 * oauth-flow.ts — 自主 PKCE OAuth 流程实现。
 *
 * 完全绕过 `claude auth login` CLI 命令，直接与 Anthropic OAuth 端点交互。
 * 原因：CLI 的非交互模式不读 stdin，无法从前端传入授权码。
 *
 * 流程：
 *   1. 生成 PKCE code_verifier + code_challenge
 *   2. 构建 authorize URL（redirect 到 Anthropic 的代码展示页）
 *   3. 用户在浏览器完成授权，复制授权码
 *   4. 后端用 code + code_verifier 交换 token
 *   5. 写入 ~/.claude/.credentials.json
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── 常量 ─────────────────────────────────────────────────────────────────────

/** Claude OAuth 常量（从 CLI 源码提取） */
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
/** Anthropic 官方代码展示页，作为 redirect_uri（已在 OAuth 服务端注册） */
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const OAUTH_SCOPE = 'user:inference';

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

// ── 类型 ─────────────────────────────────────────────────────────────────────

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

export interface CredentialsFile {
  claudeAiOauth?: OAuthTokens;
  organizationUuid?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export interface PKCEState {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  authorizeUrl: string;
  createdAt: number;
}

// ── PKCE 工具函数 ────────────────────────────────────────────────────────────

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 生成 PKCE code_verifier（43–128 字符的 URL-safe 随机字符串） */
function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

/** 从 code_verifier 生成 code_challenge（S256） */
function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

/** 生成随机 state 参数（CSRF 保护） */
function generateState(): string {
  return base64UrlEncode(crypto.randomBytes(16));
}

// ── 核心函数 ─────────────────────────────────────────────────────────────────

/**
 * 生成完整的 PKCE 状态和授权 URL。
 */
export function createOAuthSession(): PKCEState {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: OAUTH_SCOPE,
    state,
  });

  const authorizeUrl = `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;

  return {
    codeVerifier,
    codeChallenge,
    state,
    authorizeUrl,
    createdAt: Date.now(),
  };
}

/**
 * 从用户输入中提取授权码。
 * 支持：纯授权码、完整回调 URL（?code=xxx）、code#state 格式。
 */
export function extractAuthCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // 尝试从 URL 中提取 code 参数
  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get('code');
    if (fromQuery) return fromQuery;
    const hash = url.hash.replace(/^#/, '');
    const fromHash = new URLSearchParams(hash).get('code');
    if (fromHash) return fromHash;
  } catch {
    // 不是 URL，继续
  }

  // code#state 格式：只取 # 前面的部分
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx > 0) return trimmed.slice(0, hashIdx);

  return trimmed;
}

/**
 * 用授权码 + code_verifier 交换 access token。
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const body = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  };

  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Token exchange failed: HTTP ${resp.status} — ${text.slice(0, 300)}`);
  }

  const data = await resp.json() as TokenResponse;

  if (!data.access_token) {
    throw new Error('Token response missing access_token');
  }
  if (typeof data.expires_in !== 'number') {
    throw new Error('Token response missing or invalid expires_in');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    scopes: data.scope ? data.scope.split(' ') : [OAUTH_SCOPE],
  };
}

// ── 凭据文件读写 ─────────────────────────────────────────────────────────────

/**
 * 读取 ~/.claude/.credentials.json
 */
export function readCredentials(): CredentialsFile | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(raw) as CredentialsFile;
  } catch {
    return null;
  }
}

/**
 * 写入 ~/.claude/.credentials.json（原子写入）
 */
export function writeCredentials(creds: CredentialsFile): void {
  const dir = path.dirname(CREDENTIALS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = CREDENTIALS_PATH + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(creds, null, 2), 'utf8');
    fs.renameSync(tmpPath, CREDENTIALS_PATH);
  } catch {
    // Windows EPERM：rename 失败时直接写入
    try {
      fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf8');
    } catch (writeErr) {
      throw new Error(`Failed to write credentials: ${(writeErr as Error).message}`);
    }
    // 清理 tmp
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * 将 OAuth tokens 保存到 credentials 文件。
 * 保留已有的 organizationUuid 等字段。
 */
export function saveTokens(tokens: OAuthTokens): void {
  const existing = readCredentials() ?? {};
  existing.claudeAiOauth = tokens;
  writeCredentials(existing);
}

/**
 * 检查当前认证状态（直接读取 credentials 文件）。
 */
export function checkAuthFromCredentials(): {
  authenticated: boolean;
  expired: boolean;
  expiresAt: number | null;
} {
  const creds = readCredentials();
  const oauth = creds?.claudeAiOauth;

  if (!oauth?.accessToken) {
    return { authenticated: false, expired: false, expiresAt: null };
  }

  const now = Date.now();
  const expired = Boolean(oauth.expiresAt) && oauth.expiresAt < now;

  return {
    authenticated: !expired,
    expired,
    expiresAt: oauth.expiresAt || null,
  };
}
