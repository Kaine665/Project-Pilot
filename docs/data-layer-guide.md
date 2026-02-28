# 数据层升级指南：从 OpenClaw 学到的工程实践

> 基于对 OpenClaw（191k stars）源码的深度调查，提炼出适合 ProjectPilot 的数据层方向。

## 核心发现：OpenClaw 也用 JSON 文件

OpenClaw 没有用数据库。没有 SQLite，没有 Postgres，没有 Prisma。它和 ProjectPilot 一样，全部数据存在 `~/.openclaw/` 目录下的 JSON 文件里。

但它没有你遇到的那些问题（写坏、丢数据、无历史）。差别在哪？**不是存储介质不同，是写入管道不同。**

---

## 第一课：怎么存 — 原子写入

### 你现在的问题

```
persist() → fs.writeFile("data.json", content)
```

如果写到一半断电/崩溃，文件就废了 — 半截 JSON，无法解析，数据全丢。

### OpenClaw 怎么做

```
persist() → fs.writeFile("data.json.tmp.随机ID", content)
         → fs.rename("data.json.tmp.随机ID", "data.json")   ← 原子操作
```

**关键点**：`rename` 在操作系统层面是原子的 — 要么完成，要么没发生，不存在"写了一半"。

OpenClaw 的实际代码（`src/config/sessions/store.ts`）：

```typescript
// Windows 特殊处理：rename 可能因文件锁失败，所以重试
if (process.platform === "win32") {
  const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(tmp, json, "utf-8");

  for (let i = 0; i < 5; i++) {
    try {
      await fs.promises.rename(tmp, storePath);
      break;
    } catch {
      if (i < 4) await new Promise(r => setTimeout(r, 50 * (i + 1)));
    }
  }
}
```

### 你需要做的

把 ProjectPilot 的所有 `fs.writeFile(path, data)` 替换成：

```typescript
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(tmp, data, "utf-8");

  // Windows 需要重试（文件可能被杀毒软件/索引器短暂锁住）
  for (let i = 0; i < 5; i++) {
    try {
      await fs.promises.rename(tmp, filePath);
      return;
    } catch {
      if (i < 4) await new Promise(r => setTimeout(r, 50 * (i + 1)));
    }
  }
}
```

**改动量**：一个函数，替换所有写入调用点。JSON 转义错误导致文件损坏的问题直接消失。

---

## 第二课：怎么追踪变更 — 备份 + 轮转

### OpenClaw 的现实选择

OpenClaw **也没有** event sourcing，**也没有**完整的版本历史，**也没有** undo/redo。

它的策略很务实：

| 机制 | 做法 | 目的 |
|------|------|------|
| `.bak` 备份 | 每次写入前，复制当前文件为 `.bak` | 至少能恢复到上一次 |
| 文件轮转 | 文件超过 10MB 时，重命名为 `.bak.{时间戳}`，保留最近 3 个 | 防止无限膨胀 |
| JSONL 追加日志 | 会话转录用追加模式（每行一条），不覆盖 | 天然的历史记录 |
| `updatedAt` 时间戳 | 每条记录带最后修改时间 | 冲突解决和老化清理 |

**注意它没做的事**：没有给每次编辑都存一个完整快照，没有 diff，没有变更事件流。

### 适合你的方案

你的链路数据（flow JSON）不大，单个项目通常几十 KB。最实用的方案：

**方案 A：写入前自动备份（最小改动）**

```typescript
async function persistWithBackup(filePath: string, data: string): Promise<void> {
  // 1. 备份当前版本
  if (fs.existsSync(filePath)) {
    const backupPath = `${filePath}.bak`;
    await fs.promises.copyFile(filePath, backupPath);
  }

  // 2. 原子写入新版本
  await atomicWrite(filePath, data);
}
```

这就够应对"误删/写坏了想恢复"的 80% 场景。

**方案 B：带时间戳的多版本备份（更完整）**

```typescript
async function persistWithHistory(filePath: string, data: string): Promise<void> {
  if (fs.existsSync(filePath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const historyDir = `${filePath}.history`;
    await fs.promises.mkdir(historyDir, { recursive: true });
    await fs.promises.copyFile(filePath, `${historyDir}/${ts}.json`);

    // 只保留最近 N 个版本
    const files = await fs.promises.readdir(historyDir);
    if (files.length > 50) {
      const toDelete = files.sort().slice(0, files.length - 50);
      for (const f of toDelete) {
        await fs.promises.unlink(`${historyDir}/${f}`);
      }
    }
  }

  await atomicWrite(filePath, data);
}
```

**方案 C：Git 管数据（完整回溯）**

把 `data/` 目录初始化为 git repo，每次 persist 后自动 commit：

```typescript
async function persistWithGit(filePath: string, data: string): Promise<void> {
  await atomicWrite(filePath, data);

  // 后台异步提交，不阻塞主流程
  exec(`cd ${DATA_DIR} && git add -A && git commit -m "auto: ${new Date().toISOString()}" --allow-empty`,
    { timeout: 5000 });
}
```

优点：完整历史、可 diff、可回滚到任意时间点。
缺点：每次写入都 commit 可能太频繁 — 可以加防抖（比如 30 秒内合并为一次 commit）。

### 我的建议

**先做 A（最小改动），需要时升级到 C（git）。** 不要一开始就上 event sourcing，你的数据量和复杂度不需要。

---

## 第三课：怎么互相找到 — ID 规范化 + 注册表

### OpenClaw 的 Agent 引用体系

OpenClaw 的 Agent 互相找到靠三个机制：

**1. 规范化 ID**

所有 Agent ID 经过统一处理后才使用：

```typescript
export function normalizeAgentId(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "main";           // 默认值
  return trimmed
    .toLowerCase()                        // 全小写
    .replace(INVALID_CHARS_RE, "-")       // 非法字符转 -
    .replace(LEADING_DASH_RE, "")         // 去掉前导 -
    .replace(TRAILING_DASH_RE, "")        // 去掉尾部 -
    .slice(0, 64) || "main";             // 最大 64 字符
}
```

**为什么重要**：同一个 Agent，前端传来的可能是 `"Task Worker"`，配置里写的是 `"task-worker"`，URL 里是 `"task_worker"` — 如果不规范化，永远对不上。

**2. Session Key 编码了 Agent ID**

```
agent:<agentId>:<channel>:<chatType>:<peerId>
```

例如：`agent:main:discord:direct:user123`

从任何一个 session key，都能反向解析出它属于哪个 Agent。

**3. Subagent 注册表**

Agent A 生成 Agent B 时，在内存 Map 中记录一条 `SubagentRunRecord`：

```typescript
{
  runId: "run-123",
  childSessionKey: "agent:researcher:...",    // 子 Agent
  requesterSessionKey: "agent:main:...",      // 父 Agent
  task: "调研 React 19 新特性",
  outcome: undefined,                         // 完成后填入结果
}
```

- 父找子：`listRunsForRequester(parentSessionKey)`
- 子找父：`resolveRequesterForChildSession(childSessionKey)`
- 结果传递：子完成后通过 `announce` 机制把结果推回父

### 你的 Agent 引用现状 vs 改进方向

你现在的 Agent 是通过 `agentId` 字符串直接引用的，存在 `agents.json` 里。这个本身没问题，但缺少：

| 缺失 | OpenClaw 的做法 | 建议 |
|------|----------------|------|
| ID 规范化 | `normalizeAgentId()` 统一处理 | 加一个 `normalizeId()` 工具函数，所有 ID 存取前过一遍 |
| 反向查找 | session key 编码了 agent ID | 你的 session 里已有 `agentId` 字段，够用 |
| Agent 间通信 | subagent 注册表 + announce 队列 | 暂时不需要，你的 Agent 不互相调用 |

**现阶段最有价值的改进**：给所有实体（flow、session、agent、context）统一 ID 格式和查找方式。

---

## 第四课：写入校验 — Zod Schema

### OpenClaw 怎么做

OpenClaw 用 Zod 定义每种数据的 schema，加载时验证：

```typescript
import { z } from "zod";

const SessionEntrySchema = z.object({
  sessionId: z.string().uuid(),
  updatedAt: z.number(),
  channel: z.string().optional(),
  model: z.string().optional(),
  // ...
}).strict();  // 不允许多余字段

function validateConfig(config: unknown) {
  const result = SessionEntrySchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid data: ${result.error}`);
  }
  return result.data;
}
```

### 你应该做的

你现在的 `PUT /api/data` 直接信任前端发来的 JSON。加一层 Zod 校验：

```typescript
import { z } from "zod";

const TreeItemSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["todo", "doing", "done"]),
  description: z.string().optional(),
  children: z.array(TreeItemSchema).optional(),
  deferred: z.boolean().optional(),
  agentId: z.string().optional(),
}));

const FlowDataSchema = z.object({
  sections: z.array(z.object({
    id: z.string(),
    name: z.string(),
    items: z.array(TreeItemSchema),
  })),
  cycleDeadline: z.string().optional(),
});

// 在 API route 里
export async function PUT(req: Request) {
  const body = await req.json();
  const result = FlowDataSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  // 只有通过校验的数据才能写入
  await persistWithBackup(filePath, JSON.stringify(result.data, null, 2));
}
```

---

## 第五课：并发写入保护

### OpenClaw 的三层防护

```
1. 文件锁（.lock 文件） — 跨进程互斥
2. 内存队列（Map<path, Queue>）— 进程内串行化
3. 原子写入（temp + rename）— 文件系统级保护
```

### 你需要多少

ProjectPilot 是单进程 Next.js 应用，你只需要：

```
1. ❌ 文件锁 — 不需要，单进程
2. ✅ 内存队列 — 需要，防止同一文件的并发写入
3. ✅ 原子写入 — 需要，防止写入中断
```

内存队列的最小实现：

```typescript
const writeQueues = new Map<string, Promise<void>>();

async function serializedWrite(filePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(filePath) ?? Promise.resolve();
  const next = prev.then(fn, fn);  // 前一个完成后才执行
  writeQueues.set(filePath, next);
  await next;
}
```

---

## 实施路线图

按这个顺序，每一步都能独立跑起来：

### 第 1 步：原子写入（1 小时）

写一个 `atomicWrite()` 函数，替换所有 `fs.writeFile` 调用。

**效果**：JSON 写坏导致数据丢失 → 消失

### 第 2 步：写入前备份（30 分钟）

在 `atomicWrite` 外面包一层 `persistWithBackup`。

**效果**：误删/误改 → 可以从 `.bak` 恢复

### 第 3 步：Zod 校验（2-3 小时）

给 FlowData 和 Session 写 Zod schema，在 API route 的写入端点加校验。

**效果**：前端发来非法数据 → 被拒绝，不会写入

### 第 4 步：写入队列（30 分钟）

加 `serializedWrite()`，防止同一文件并发写入。

**效果**：快速连续操作导致数据错乱 → 消失

### 第 5 步：ID 规范化（1 小时）

写一个 `normalizeId()` 函数，所有实体 ID 存取前统一处理。

**效果**：ID 对不上导致引用失效 → 消失

---

## 第 1-5 步之后

这五步完成后，你的数据层就有了 OpenClaw 级别的基础稳定性。
然后再考虑"一切皆文档"的统一模型 — 那是架构层面的事，
建立在稳定的数据层之上才有意义。

**先让地基稳，再谈设计。**

---

## 附录：OpenClaw 数据目录结构参考

```
~/.openclaw/
├── openclaw.json                    # 主配置（JSON5，支持注释）
├── auth-profiles.json               # 认证凭证
├── state/
│   └── agents/
│       └── {agentId}/
│           └── sessions/
│               ├── sessions.json          # 会话索引
│               └── {sessionId}.jsonl      # 会话转录（追加日志）
├── cron/
│   └── jobs.json                    # 定时任务
└── skills/                          # 已安装的技能
```

值得注意的设计选择：
- **按 Agent 分目录** — 每个 Agent 的 session 数据隔离
- **索引和详情分离** — `sessions.json` 只存索引，详细内容在单独的 `.jsonl` 文件
- **JSONL 追加日志** — 会话转录从不覆盖，只追加行，天然有历史
