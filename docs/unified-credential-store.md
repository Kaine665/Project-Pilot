# 统一凭据存储设计（Unified Credential Store）

> **状态**: 设计中（Draft）
> **关联待办**: todo-1773664101452（Token/Key 分散存储统一管理）
> **影响范围**: settings-manager / oauth-flow / token-refresh-manager / auth-status / types

---

## 1. 问题描述

当前 API Key 和 OAuth Token 分散在多处，缺乏统一管理：

### 1.1 API Key 存储碎片化

同一个供应商的 API Key 可能存在三个地方：

| 存储位置 | 说明 | 代码路径 |
|----------|------|----------|
| `settings.claude.providerApiKeys[provider]` | 新的 per-provider 存储 | `settings-manager.ts` |
| `settings.claude.customProviders[].apiKey` | 自定义供应商独有字段 | `types/index.ts` |
| `settings.claude.apiKey` | 已弃用的 flat 字段 | `types/index.ts` |

读取时 `getProviderScopedApiKey()` 按优先级依次尝试三处，写入时前端不一定写同一处。

### 1.2 OAuth Token 与设置分离

| 供应商 | Token 位置 | 管理方式 |
|--------|-----------|----------|
| Anthropic | `~/.claude/.credentials.json` | 自主 PKCE + TokenRefreshManager |
| OpenAI | `~/.codex/auth.json` | 委托 `codex login` CLI |
| 其他 | 无 OAuth | API Key only |

`settings.json` 不知道 OAuth Token 的状态；`TokenRefreshManager` 不知道 `settings.json` 里的配置。两者靠硬编码的文件路径"碰巧"对接。

### 1.3 authMode 是全局的

```typescript
// 当前：一个 authMode 覆盖所有供应商
interface ClaudeSettings {
  authMode: ClaudeAuthMode; // 'api_key' | 'oauth' — 全局
}
```

用户切换供应商时 authMode 不变，导致：
- 从 Anthropic（oauth）切到 DeepSeek（api_key）→ 仍是 oauth 模式 → 不注入 API Key
- 从 DeepSeek 切回 Anthropic → 仍是 api_key 模式 → 不用已有的 OAuth Token

### 1.4 凭据验证缺失

- 第三方 API Key 从不验证（保存即生效，调用时才发现错误）
- OAuth 状态检查不在页面加载时触发
- 切换供应商后不检查新供应商的认证状态

---

## 2. 设计目标

1. **单一数据源**：每个供应商的凭据只存一处
2. **Per-provider authMode**：每个供应商独立记录自己的认证方式
3. **统一读取接口**：一个函数获取任意供应商的有效凭据
4. **向后兼容**：迁移旧数据，不破坏已有配置
5. **最小改动**：不改变 OAuth 流程本身，只统一存储和读取层

---

## 3. 数据模型

### 3.1 新增 `ProviderCredential` 类型

```typescript
/** 单个供应商的凭据记录 */
interface ProviderCredential {
  /** 认证方式 */
  authMode: 'api_key' | 'oauth';
  /** API Key（authMode='api_key' 时有效） */
  apiKey?: string;
  /** OAuth 状态（authMode='oauth' 时有效） */
  oauth?: {
    /** Token 文件路径（如 ~/.claude/.credentials.json），运行时解析 */
    tokenFile: string;
    /** 上次检查时的状态 */
    lastStatus?: 'authenticated' | 'expired' | 'unknown';
    /** 上次检查时间 */
    lastCheckedAt?: number;
  };
  /** 上次成功验证的时间（API Key 或 OAuth 均适用） */
  lastVerifiedAt?: number;
}
```

### 3.2 修改 `ClaudeSettings`

```typescript
interface ClaudeSettings {
  provider: ProviderId;

  // ── 新增 ──
  /** 每供应商凭据 */
  providerCredentials?: Partial<Record<ProviderId, ProviderCredential>>;

  // ── 保留（只读兼容） ──
  /** @deprecated 迁移后不再写入。读取时由 migration 层填充到 providerCredentials */
  authMode?: ClaudeAuthMode;
  /** @deprecated */
  apiKey?: string;
  /** @deprecated 迁移后 API Key 统一到 providerCredentials */
  providerApiKeys?: Partial<Record<ProviderId, string>>;

  // ── 不变 ──
  model: string;
  baseUrl?: string;
  providerModels?: Partial<Record<ProviderId, string>>;
  providerBaseUrls?: Partial<Record<ProviderId, string>>;
  providerModelLibrary?: Partial<Record<ProviderId, string[]>>;
  customProviders?: CustomProviderConfig[];
  // ... 其余字段不变
}
```

### 3.3 CustomProviderConfig 的 apiKey 去重

```typescript
interface CustomProviderConfig {
  id: `custom-${string}`;
  name: string;
  // ... 其余字段不变
  /** @deprecated API Key 统一到 providerCredentials[id].apiKey */
  apiKey?: string;
}
```

迁移后，`customProviders[].apiKey` 仅用于旧数据读取兼容。

---

## 4. 核心接口

### 4.1 `getCredential(provider)` — 统一读取

替代现有的 `getProviderScopedApiKey()`，返回完整凭据信息：

```typescript
interface ResolvedCredential {
  authMode: 'api_key' | 'oauth';
  /** API Key（api_key 模式下保证有值，否则 undefined） */
  apiKey?: string;
  /** OAuth access token（oauth 模式下尝试读取，可能为 undefined 表示未认证） */
  accessToken?: string;
  /** OAuth token 是否已过期 */
  expired?: boolean;
  /** 凭据来源（调试用） */
  source: 'providerCredentials' | 'providerApiKeys' | 'customProvider' | 'legacyApiKey' | 'oauthFile';
}

function getCredential(
  claude: ClaudeSettings,
  provider?: ProviderId,
): ResolvedCredential;
```

**读取优先级（向后兼容）**：
1. `providerCredentials[p]` — 新数据
2. `providerApiKeys[p]` — 旧 per-provider 数据
3. `customProviders[].apiKey` — 自定义供应商旧数据
4. `claude.apiKey`（仅 anthropic）— 最旧的 flat 数据

### 4.2 `setCredential(provider, credential)` — 统一写入

所有凭据写入都通过此函数，保证只写 `providerCredentials[p]`：

```typescript
async function setCredential(
  provider: ProviderId,
  credential: Partial<ProviderCredential>,
): Promise<void>;
```

### 4.3 `getEffectiveAuthMode(provider)` — 确定认证方式

```typescript
function getEffectiveAuthMode(
  claude: ClaudeSettings,
  provider?: ProviderId,
): 'api_key' | 'oauth';
```

逻辑：
1. 若 `providerCredentials[p].authMode` 存在 → 使用它
2. 否则根据供应商类型推断：
   - `anthropic` / `openai`：检查是否有 OAuth Token 文件 → 有则 `oauth`，否则 `api_key`
   - 其他供应商：始终 `api_key`

---

## 5. 迁移策略

### 5.1 运行时迁移（Lazy Migration）

在 `getSettings()` 返回前，执行一次数据规范化：

```typescript
function migrateCredentials(settings: AppSettings): AppSettings {
  const claude = settings.claude;
  if (claude.providerCredentials) return settings; // 已迁移

  const creds: Partial<Record<ProviderId, ProviderCredential>> = {};

  // 1. 从 providerApiKeys 迁移
  if (claude.providerApiKeys) {
    for (const [p, key] of Object.entries(claude.providerApiKeys)) {
      if (key) {
        creds[p as ProviderId] = { authMode: 'api_key', apiKey: key };
      }
    }
  }

  // 2. 从 customProviders[].apiKey 迁移
  if (claude.customProviders) {
    for (const cp of claude.customProviders) {
      if (cp.apiKey && !creds[cp.id]) {
        creds[cp.id] = { authMode: 'api_key', apiKey: cp.apiKey };
      }
    }
  }

  // 3. 从旧 flat apiKey 迁移（仅 anthropic）
  if (claude.apiKey && !creds['anthropic']) {
    creds['anthropic'] = { authMode: 'api_key', apiKey: claude.apiKey };
  }

  // 4. Anthropic OAuth：检查 credentials 文件
  if (claude.authMode === 'oauth' || checkCredentialsFileExists()) {
    const existing = creds['anthropic'] ?? { authMode: 'oauth' as const };
    existing.authMode = claude.authMode === 'oauth' ? 'oauth' : existing.authMode;
    existing.oauth = {
      tokenFile: '~/.claude/.credentials.json',
    };
    creds['anthropic'] = existing;
  }

  claude.providerCredentials = creds;
  return settings;
}
```

迁移是**幂等**的：已有 `providerCredentials` 则跳过。

### 5.2 写入时清理

调用 `saveSettings()` 时，不再写入旧字段。旧字段保留在文件中供降级兼容，但新代码只读 `providerCredentials`。

---

## 6. 受影响的模块

### 6.1 `settings-manager.ts`

| 函数 | 改动 |
|------|------|
| `getSettings()` | 返回前调用 `migrateCredentials()` |
| `getProviderScopedApiKey()` | 内部改为调用 `getCredential()` 返回 apiKey |
| `buildClaudeEnv()` | 用 `getCredential()` + `getEffectiveAuthMode()` 替代现有分支逻辑 |
| `buildCodexExecEnv()` | 同上 |

### 6.2 `oauth-flow.ts`

| 函数 | 改动 |
|------|------|
| `saveTokens()` | 增加：更新 `providerCredentials['anthropic'].oauth.lastStatus` |

### 6.3 `token-refresh-manager.ts`

| 改动 | 说明 |
|------|------|
| 读取路径 | 从 `providerCredentials['anthropic'].oauth.tokenFile` 获取，而非硬编码 |
| 刷新后 | 更新 `lastStatus` 和 `lastCheckedAt` |

### 6.4 `auth-status/route.ts`

| 改动 | 说明 |
|------|------|
| Anthropic 分支 | 改用 `getCredential('anthropic')` 判断模式后再检查 |
| 第三方分支 | 新增：检查 `providerCredentials[p].apiKey` 是否存在 |

### 6.5 `auth-login/route.ts` 和 `auth-code/route.ts`

| 改动 | 说明 |
|------|------|
| 登录成功后 | 调用 `setCredential('anthropic', { authMode: 'oauth', ... })` |

### 6.6 前端 Settings 页

| 改动 | 说明 |
|------|------|
| authMode 切换 | 改为写入 `providerCredentials[currentProvider].authMode` |
| API Key 输入 | 改为写入 `providerCredentials[currentProvider].apiKey` |
| 供应商切换 | 读取新供应商的 `providerCredentials[newProvider]` 以显示正确的 UI 状态 |

---

## 7. buildClaudeEnv 简化

改动前（当前逻辑，约 50 行分支）：

```typescript
if (provider === 'anthropic' || provider === 'openai') {
  if (claude.authMode === 'api_key' && scopedKey && !process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = scopedKey;
  }
  // ...
} else {
  // 第三方：AUTH_TOKEN vs API_KEY 分支...
}
```

改动后：

```typescript
const cred = getCredential(claude, provider);
const preset = getProviderPreset(provider, claude.customProviders);

if (cred.authMode === 'api_key' && cred.apiKey) {
  const useApiKey = provider === 'anthropic' || provider === 'kimi' || preset.authMethod === 'API_KEY';
  if (useApiKey) {
    env.ANTHROPIC_API_KEY = cred.apiKey;
    delete env.ANTHROPIC_AUTH_TOKEN;
  } else {
    env.ANTHROPIC_AUTH_TOKEN = cred.apiKey;
    delete env.ANTHROPIC_API_KEY;
  }
} else if (cred.authMode === 'oauth') {
  // OAuth 模式：不注入 key，让 CLI/SDK 读 credentials 文件
  // （Anthropic CLI 自动从 ~/.claude/.credentials.json 读取）
}
```

---

## 8. 实施顺序

### Phase 1: 数据层（~2h）

1. 在 `types/index.ts` 中添加 `ProviderCredential` 类型
2. 在 `settings-manager.ts` 中实现 `migrateCredentials()`、`getCredential()`、`setCredential()`、`getEffectiveAuthMode()`
3. 让 `getProviderScopedApiKey()` 内部委托给 `getCredential()` — 保持现有调用者不改动

### Phase 2: 后端统一（~2h）

4. 修改 `buildClaudeEnv()` 使用新接口
5. 修改 `auth-status/route.ts` 使用新接口
6. 修改 `auth-login/route.ts` 和 `auth-code/route.ts` 在成功后调用 `setCredential()`
7. 修改 `token-refresh-manager.ts` 从凭据配置读路径

### Phase 3: 前端适配（~2h）

8. Settings 页面的 authMode 切换改为 per-provider
9. API Key 输入改为通过新 API 写入 `providerCredentials`
10. 供应商切换时读取正确的凭据状态

### Phase 4: 清理（~30min）

11. 标记旧字段为 `@deprecated`
12. 更新 `data-storage.md` 文档

---

## 9. 不做的事

- **不改变 OAuth 流程本身**：Anthropic PKCE 和 OpenAI device code 流程保持原样
- **不移动 credentials 文件**：`~/.claude/.credentials.json` 和 `~/.codex/auth.json` 位置不变（CLI 依赖这些路径）
- **不加密 API Key**：settings.json 已是用户本地文件，加密增加复杂度但安全性提升有限
- **不做 API Key 在线验证**：这是另一个待办（todo-1773664100140）的范围

---

## 10. 风险与回退

| 风险 | 缓解 |
|------|------|
| 迁移丢失旧 Key | Lazy migration 只读旧字段不删除；`saveSettings` 保留旧字段在 JSON 中 |
| 前端读到未迁移数据 | `getCredential()` 的回退链覆盖所有旧存储位置 |
| 并发写入竞争 | 沿用现有 settings-manager 的缓存 + 单进程模型 |
