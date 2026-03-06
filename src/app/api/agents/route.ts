import { NextRequest, NextResponse } from 'next/server';
import { getAgentsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import { readPromptFile, writePromptFile, deletePromptFile, resolveSystemPrompt } from '@/lib/agent-prompt-store';
import { getSettings } from '@/lib/settings-manager';
import type { Agent, AgentCapabilities, AgentsData } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import type { ResourceRef } from '@/types/resource';

// ── 进程内缓存（同 settings-manager 模式）──
// agents 数据变化极少，30s TTL 避免每次 GET 都读磁盘 + 跑迁移逻辑。
// 写操作（POST/PATCH/DELETE）后立即失效缓存。

const AGENTS_CACHE_TTL_MS = 30_000;

/** 元数据缓存（不含 systemPrompt） */
let _cachedData: AgentsData | null = null;
/** 带 systemPrompt 的完整列表缓存（供 GET 直接返回） */
let _cachedWithPrompts: Agent[] | null = null;
let _cacheTimestamp = 0;

/** 上次成功读取到的 agent 数量，用于写入前校验防止数据丢失 */
let _lastKnownAgentCount = 0;

/**
 * 使 agents 缓存失效。
 * 本模块的写操作 + 外部路由写 agents.json 后都应调用。
 */
export function invalidateAgentsCache(): void {
  _cachedData = null;
  _cachedWithPrompts = null;
  _cacheTimestamp = 0;
}

async function readAgents(): Promise<AgentsData> {
  const now = Date.now();
  if (_cachedData && now - _cacheTimestamp < AGENTS_CACHE_TTL_MS) {
    return _cachedData;
  }

  const data = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
  // ── 内置 Agent 字段迁移 ──
  // 磁盘上的 agents.json 可能是旧版本写入的，缺少后来新增的字段（如 capabilities）。
  // 必须在每次读取时将 DEFAULT_AGENTS 的新字段合并进来，否则下游（settings-manager
  // 的 buildAgentPermissionArgs 等）会回退到 DEFAULT_AGENT_CAPABILITIES，导致
  // skipReview=false → Claude 进程缺少 --dangerously-skip-permissions → 非交互模式卡死。
  // 同样的合并逻辑在 agent-chat-manager.ts 的 start() 中也有一份（运行时双保险）。
  let changed = false;
  for (const defaultAgent of DEFAULT_AGENTS) {
    const existing = data.agents.find(a => a.id === defaultAgent.id);
    if (!existing) {
      data.agents.unshift(defaultAgent);
      changed = true;
    } else {
      // Merge missing fields from default (e.g. capabilities added later)
      for (const key of Object.keys(defaultAgent) as Array<keyof Agent>) {
        if (existing[key] === undefined && defaultAgent[key] !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (existing as any)[key] = defaultAgent[key];
          changed = true;
        }
      }
    }
  }

  // ── systemPrompt 外置懒迁移 ──
  // 旧版 agents.json 中 systemPrompt 是内联字符串，现在迁移到 prompts/{agentId}.md 文件。
  // 首次读取时：如果 agent 有内联 systemPrompt 且无对应 .md 文件，写文件并从 JSON 中删除。
  for (const agent of data.agents) {
    if (agent.systemPrompt) {
      const existingFile = await readPromptFile(agent.id);
      if (!existingFile) {
        await writePromptFile(agent.id, agent.systemPrompt);
      }
      delete agent.systemPrompt;
      changed = true;
    }
  }

  if (changed) {
    await writeAgents(data);
  }

  // 记录当前 agent 总数（含 archived），供 writeAgents 做丢失检测
  _lastKnownAgentCount = data.agents.length;

  // 写入缓存
  _cachedData = data;
  _cacheTimestamp = Date.now();
  // 元数据变了，prompt 缓存也需要重建
  _cachedWithPrompts = null;

  return data;
}

async function writeAgents(data: AgentsData): Promise<void> {
  // ── 写入前数据丢失检测 ──
  // 如果即将写入的 agent 数量比上次读取的少超过一半，大概率是数据损坏导致的，
  // 拒绝写入以保护磁盘上的完整数据。
  // _lastKnownAgentCount === 0 表示还没有成功读取过（首次启动），跳过检测。
  const newCount = data.agents.length;
  if (_lastKnownAgentCount > DEFAULT_AGENTS.length && newCount <= DEFAULT_AGENTS.length) {
    console.error(
      `[agents] WRITE BLOCKED: agent count dropped from ${_lastKnownAgentCount} to ${newCount}. ` +
      `This looks like data corruption. Refusing to overwrite agents.json.`
    );
    return;
  }
  await writeJsonFile(getAgentsPath(), data);
  invalidateAgentsCache();
}

/** GET /api/agents — list all agents (excludes archived by default) */
export async function GET(request: NextRequest) {
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';

  // 尝试用带 prompt 的缓存（避免每次 GET 都 N+1 磁盘 I/O）
  const now = Date.now();
  if (_cachedWithPrompts && now - _cacheTimestamp < AGENTS_CACHE_TTL_MS) {
    const agents = includeArchived ? _cachedWithPrompts : _cachedWithPrompts.filter(a => !a.archived);
    return NextResponse.json({ agents });
  }

  const data = await readAgents();

  // 批量 resolve prompts 并缓存
  const agentsWithPrompts = await Promise.all(
    data.agents.map(async (agent) => ({
      ...agent,
      systemPrompt: await resolveSystemPrompt(agent.id, agent.systemPrompt),
    }))
  );
  _cachedWithPrompts = agentsWithPrompts;

  const agents = includeArchived ? agentsWithPrompts : agentsWithPrompts.filter(a => !a.archived);
  return NextResponse.json({ agents });
}

/** POST /api/agents — create a new agent */
export async function POST(request: NextRequest) {
  const { name, description, systemPrompt, icon, capabilities, requiredParams, contextIds, defaultResources } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const promptText = systemPrompt?.trim() || undefined;
  const now = new Date().toISOString();

  // When no capabilities are provided, apply global default for exposePromptPath
  let effectiveCaps: AgentCapabilities;
  if (capabilities) {
    effectiveCaps = capabilities;
  } else {
    const settings = await getSettings();
    const exposeByDefault = settings.claude.defaultExposePromptPath !== false;
    effectiveCaps = { ...DEFAULT_AGENT_CAPABILITIES, exposePromptPath: exposeByDefault };
  }

  const agent: Agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    description: description?.trim() || undefined,
    // systemPrompt 不存入 agents.json，外置到 .md 文件
    icon: icon?.trim() || undefined,
    capabilities: effectiveCaps,
    requiredParams: Array.isArray(requiredParams) && requiredParams.length > 0 ? requiredParams : undefined,
    contextIds: Array.isArray(contextIds) && contextIds.length > 0 ? contextIds : undefined,
    defaultResources: Array.isArray(defaultResources) && defaultResources.length > 0 ? defaultResources as ResourceRef[] : undefined,
    createdAt: now,
    updatedAt: now,
  };

  // 将 systemPrompt 写入外置文件
  if (promptText) {
    await writePromptFile(agent.id, promptText);
  }

  const data = await readAgents();
  data.agents.push(agent);
  await writeAgents(data);

  // 响应中带上 systemPrompt（前端仍需要此字段）
  return NextResponse.json({ ok: true, agent: { ...agent, systemPrompt: promptText } });
}

/** PATCH /api/agents — update an agent. Body: { id, ...fields } */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, name, description, systemPrompt, icon, capabilities, requiredParams, contextIds, defaultResources } = body;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // Reject attempts to modify immutable fields
  if (body.slug !== undefined || body.builtIn !== undefined) {
    return NextResponse.json({ error: 'Cannot modify slug or builtIn fields' }, { status: 403 });
  }

  const data = await readAgents();
  const agent = data.agents.find(a => a.id === id);
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }

  if (name !== undefined) agent.name = name.trim();
  if (description !== undefined) agent.description = description.trim() || undefined;
  if (icon !== undefined) agent.icon = icon.trim() || undefined;
  if (capabilities !== undefined) agent.capabilities = capabilities as AgentCapabilities;
  if (requiredParams !== undefined) agent.requiredParams = Array.isArray(requiredParams) && requiredParams.length > 0 ? requiredParams : undefined;
  if (contextIds !== undefined) agent.contextIds = Array.isArray(contextIds) && contextIds.length > 0 ? contextIds : undefined;
  if (defaultResources !== undefined) agent.defaultResources = Array.isArray(defaultResources) && defaultResources.length > 0 ? defaultResources as ResourceRef[] : undefined;

  // systemPrompt 写入外置 .md 文件，不存入 agents.json
  if (systemPrompt !== undefined) {
    const promptText = systemPrompt.trim();
    if (promptText) {
      await writePromptFile(agent.id, promptText);
    } else {
      await deletePromptFile(agent.id);
    }
    delete agent.systemPrompt;
  }

  agent.updatedAt = new Date().toISOString();

  await writeAgents(data);

  // 响应中带上 systemPrompt（前端仍需要此字段）
  const resolved = await resolveSystemPrompt(agent.id, agent.systemPrompt);
  return NextResponse.json({ ok: true, agent: { ...agent, systemPrompt: resolved } });
}

/** DELETE /api/agents — soft-delete an agent (move to recycle bin). Body: { id } */
export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const data = await readAgents();
  const agent = data.agents.find(a => a.id === id);
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }

  if (agent.builtIn) {
    return NextResponse.json({ error: 'Cannot delete a built-in agent' }, { status: 403 });
  }

  agent.archived = true;
  agent.archivedAt = new Date().toISOString();
  agent.updatedAt = new Date().toISOString();
  await writeAgents(data);

  return NextResponse.json({ ok: true });
}
