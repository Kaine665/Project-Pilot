/**
 * token-refresh-manager.ts — 主动刷新 OAuth token，防止过期。
 *
 * 问题背景：
 *   Claude Code CLI 在内存中自动刷新 OAuth access_token，但不一定写回
 *   ~/.claude/.credentials.json。当 ProjectPilot 通过 SDK 的 query() 每次
 *   spawn 新 CLI 子进程时，子进程读到文件里已过期的 token，导致 401 认证失败。
 *
 * 解决方案：
 *   在 Sidecar 中定时检查 credentials 文件，token 快过期时直接调用 OAuth
 *   token endpoint 刷新并写回文件，确保所有 CLI 子进程都能读到有效 token。
 *
 * 刷新策略：
 *   - 每 5 分钟检查一次
 *   - token 还有 30 分钟以内到期时触发刷新
 *   - 刷新失败静默重试，不阻塞主流程
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ── 常量 ─────────────────────────────────────────────────────────────────────

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const CHECK_INTERVAL_MS = 5 * 60 * 1000;       // 5 分钟检查一次
const REFRESH_THRESHOLD_MS = 30 * 60 * 1000;    // 过期前 30 分钟就刷新

/** Claude OAuth 常量（从 CLI 源码提取） */
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_SCOPES = [
  'org:create_api_key',
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
];

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

interface CredentialsFile {
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

// ── 核心 ─────────────────────────────────────────────────────────────────────

const TAG = '[TokenRefresh]';

class TokenRefreshManager {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _refreshing = false;

  /**
   * 启动定时检查。在 Sidecar 启动时调用一次。
   */
  init(): void {
    // 启动后立即做一次检查
    void this._check();

    this._timer = setInterval(() => {
      void this._check();
    }, CHECK_INTERVAL_MS);

    // 不阻止进程退出
    this._timer.unref();

    console.log(`${TAG} 初始化完成，每 ${CHECK_INTERVAL_MS / 60000} 分钟检查一次`);
  }

  /**
   * 停止定时检查。
   */
  destroy(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ── 内部方法 ──────────────────────────────────────────────────────────────

  private async _check(): Promise<void> {
    if (this._refreshing) return;

    try {
      const creds = this._readCredentials();
      if (!creds?.claudeAiOauth) return; // 非 OAuth 模式，跳过

      const oauth = creds.claudeAiOauth;
      if (!oauth.refreshToken || !oauth.expiresAt) return; // 无 refresh token

      const timeUntilExpiry = oauth.expiresAt - Date.now();

      if (timeUntilExpiry > REFRESH_THRESHOLD_MS) {
        // token 还很新鲜，不需要刷新
        return;
      }

      const minutesLeft = Math.round(timeUntilExpiry / 60000);
      console.log(`${TAG} Access token ${timeUntilExpiry > 0 ? `将在 ${minutesLeft} 分钟后过期` : '已过期'}，开始刷新...`);

      this._refreshing = true;
      await this._refresh(creds, oauth);
    } catch (err) {
      console.error(`${TAG} 检查失败:`, (err as Error).message);
    } finally {
      this._refreshing = false;
    }
  }

  private async _refresh(creds: CredentialsFile, oauth: OAuthTokens): Promise<void> {
    const body = {
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: OAUTH_CLIENT_ID,
      scope: (oauth.scopes?.length ? oauth.scopes : OAUTH_SCOPES).join(' '),
    };

    const resp = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`${TAG} 刷新失败: HTTP ${resp.status}`, text.slice(0, 200));
      return;
    }

    const data = await resp.json() as TokenResponse;

    if (!data.access_token) {
      console.error(`${TAG} 刷新响应缺少 access_token`);
      return;
    }

    // 更新凭据
    creds.claudeAiOauth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? oauth.refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
      scopes: data.scope ? data.scope.split(' ') : oauth.scopes,
      subscriptionType: oauth.subscriptionType ?? null,
      rateLimitTier: oauth.rateLimitTier ?? null,
    };

    this._writeCredentials(creds);

    const expiresIn = Math.round((data.expires_in ?? 0) / 3600);
    console.log(`${TAG} 刷新成功，新 token 有效期 ${expiresIn} 小时`);
  }

  private _readCredentials(): CredentialsFile | null {
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
      return JSON.parse(raw) as CredentialsFile;
    } catch {
      return null; // 文件不存在或格式错误
    }
  }

  private _writeCredentials(creds: CredentialsFile): void {
    // 先写 tmp 再 rename，保证原子性
    const tmpPath = CREDENTIALS_PATH + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(creds, null, 2), 'utf8');
      fs.renameSync(tmpPath, CREDENTIALS_PATH);
    } catch (err) {
      // Windows EPERM：rename 失败时直接写入
      try {
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf8');
      } catch (writeErr) {
        console.error(`${TAG} 写入凭据文件失败:`, (writeErr as Error).message);
      }
      // 清理 tmp
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

export const tokenRefreshManager = new TokenRefreshManager();
