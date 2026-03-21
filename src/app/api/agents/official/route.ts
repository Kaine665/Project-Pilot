import { NextRequest, NextResponse } from 'next/server';
import type { Agent, AgentCapabilities, OpenAIReasoningEffort } from '@/types';
import type { ResourceRef } from '@/types/resource';
import {
  archiveAgent,
  createAgent,
  getAgentById,
  getAgentBySlug,
  listAgents,
  updateAgent,
} from '@/lib/agents-store';

interface AgentMatchInput {
  id?: string;
  slug?: string;
}

interface OfficialAgentPayload {
  name?: string;
  description?: string;
  systemPrompt?: string;
  icon?: string;
  capabilities?: AgentCapabilities;
  requiredParams?: string[];
  contextIds?: string[];
  defaultResources?: ResourceRef[];
  projectKey?: string;
  triggerHints?: string[];
  defaultProvider?: Agent['defaultProvider'];
  defaultModel?: string;
  defaultOpenAIReasoningEffort?: OpenAIReasoningEffort | null;
  contextStrategy?: 'additive' | 'exclusive';
}

interface OfficialAgentsUpsertRequest {
  action: 'upsert';
  match?: AgentMatchInput;
  createIfMissing?: boolean;
  agent: OfficialAgentPayload;
}

interface OfficialAgentsArchiveRequest {
  action: 'archive';
  match: AgentMatchInput;
}

type OfficialAgentsWriteRequest =
  | OfficialAgentsUpsertRequest
  | OfficialAgentsArchiveRequest;

async function resolveMatch(match?: AgentMatchInput, includePrompt = false): Promise<Agent | undefined> {
  if (!match) return undefined;
  if (match.id) {
    return getAgentById(match.id, { includeArchived: true, includePrompt });
  }
  if (match.slug) {
    return getAgentBySlug(match.slug, { includeArchived: true, includePrompt });
  }
  return undefined;
}

/** GET /api/agents/official - machine-oriented official agents API */
export async function GET(request: NextRequest) {
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
  const includePrompt = request.nextUrl.searchParams.get('includePrompt') === 'true';
  const projectKey = request.nextUrl.searchParams.get('projectKey') || undefined;
  const id = request.nextUrl.searchParams.get('id') || undefined;
  const slug = request.nextUrl.searchParams.get('slug') || undefined;

  if (id || slug) {
    const agent = id
      ? await getAgentById(id, { includeArchived, includePrompt })
      : await getAgentBySlug(slug!, { includeArchived, includePrompt });

    if (!agent) {
      return NextResponse.json(
        { ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, agent });
  }

  const agents = await listAgents({ includeArchived, includePrompts: includePrompt, projectKey });
  return NextResponse.json({ ok: true, agents });
}

/** POST /api/agents/official - official write API for external callers */
export async function POST(request: NextRequest) {
  const body = await request.json() as OfficialAgentsWriteRequest;

  if (body.action === 'upsert') {
    if (!body.agent) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_REQUEST', message: 'agent payload is required' } },
        { status: 400 },
      );
    }

    const matched = await resolveMatch(body.match, true);
    if (matched) {
      const agent = await updateAgent(matched.id, body.agent);
      return NextResponse.json({
        ok: true,
        action: 'upsert',
        created: false,
        updated: true,
        matchedBy: body.match?.id ? 'id' : body.match?.slug ? 'slug' : 'id',
        agent,
      });
    }

    if (body.createIfMissing === false) {
      return NextResponse.json(
        { ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'No matching agent to update' } },
        { status: 404 },
      );
    }

    if (!body.agent.name?.trim()) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_REQUEST', message: 'agent.name is required when creating a new agent' } },
        { status: 400 },
      );
    }

    const agent = await createAgent({
      ...body.agent,
      name: body.agent.name,
    });

    return NextResponse.json({
      ok: true,
      action: 'upsert',
      created: true,
      updated: false,
      agent,
    });
  }

  if (body.action === 'archive') {
    const matched = await resolveMatch(body.match, false);
    if (!matched) {
      return NextResponse.json(
        { ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } },
        { status: 404 },
      );
    }
    if (matched.builtIn) {
      return NextResponse.json(
        { ok: false, error: { code: 'BUILTIN_AGENT', message: 'Built-in agents cannot be archived' } },
        { status: 403 },
      );
    }

    const agent = await archiveAgent(matched.id);
    return NextResponse.json({ ok: true, action: 'archive', agent });
  }

  return NextResponse.json(
    { ok: false, error: { code: 'INVALID_ACTION', message: 'Supported actions: upsert, archive' } },
    { status: 400 },
  );
}
