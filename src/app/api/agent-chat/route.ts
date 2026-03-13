import { NextRequest, NextResponse } from 'next/server';
import { generateSessionId } from '@/lib/agent-chat-manager';
import type { ImageAttachment, ImageMediaType, FlowContext } from '@/lib/agent-chat-manager';
import type { SessionConfig } from '@/types/agent-chat';
import { getFlowDataPath, getFlowIndexPath, readJsonFile, ensureFlowsMigrated } from '@/lib/file-store';
import { isValidProjectKey, isValidSessionId } from '@/lib/security';
import { PROVIDER_REGISTRY } from '@/lib/provider-registry';
import type { OpenAIReasoningEffort, ProviderId } from '@/types';
import { sidecarFetch } from '@/lib/sidecar-bridge';

interface ProjectIndex {
  projects: Array<{ key: string; name: string }>;
}

const ALLOWED_IMAGE_TYPES: ImageMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image (base64 decoded)
const ALLOWED_PROVIDERS: ProviderId[] = PROVIDER_REGISTRY.map((p) => p.id);
const ALLOWED_OPENAI_EFFORTS: OpenAIReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

/**
 * POST /api/agent-chat
 * Start an agent chat conversation.
 * Body: { agentId, message, sessionId?, projectKey?, providerOverride?, modelOverride?, effortOverride?, images?: [{mediaType, data}], config?: SessionConfig, parentSessionId? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    agentId, message, sessionId: requestedSessionId, projectKey,
    providerOverride, modelOverride, effortOverride,
    images, initialTitle, config, parentSessionId, depth,
  } = body as {
    agentId: string;
    message: string;
    sessionId?: string;
    projectKey?: string;
    providerOverride?: ProviderId;
    modelOverride?: string;
    effortOverride?: OpenAIReasoningEffort;
    images?: Array<{ mediaType: string; data: string }>;
    initialTitle?: string;
    config?: SessionConfig;
    parentSessionId?: string;
    depth?: number;
  };

  // 🔒 Security: validate required fields
  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }

  // 🔒 Security: validate message
  if (typeof message !== 'string' || message.length > 10000) {
    return NextResponse.json(
      { error: 'message must be a string up to 10000 characters' },
      { status: 400 },
    );
  }

  // Must have at least a message or an image
  const hasImages = Array.isArray(images) && images.length > 0;
  if (message.length === 0 && !hasImages) {
    return NextResponse.json({ error: 'message or at least one image is required' }, { status: 400 });
  }

  // 🔒 Security: validate images if provided
  let validatedImages: ImageAttachment[] | undefined;
  if (hasImages) {
    if (images!.length > MAX_IMAGES) {
      return NextResponse.json({ error: `At most ${MAX_IMAGES} images per message` }, { status: 400 });
    }
    validatedImages = [];
    for (const img of images!) {
      if (!ALLOWED_IMAGE_TYPES.includes(img.mediaType as ImageMediaType)) {
        return NextResponse.json({ error: `Unsupported image type: ${img.mediaType}` }, { status: 400 });
      }
      if (typeof img.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(img.data)) {
        return NextResponse.json({ error: 'Invalid image data (must be base64)' }, { status: 400 });
      }
      const decodedSize = Math.floor(img.data.length * 0.75);
      if (decodedSize > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'Image too large (max 5 MB per image)' }, { status: 400 });
      }
      validatedImages.push({ mediaType: img.mediaType as ImageMediaType, data: img.data });
    }
  }

  // 🔒 Security: validate sessionId if provided
  if (requestedSessionId && !isValidSessionId(requestedSessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId format' }, { status: 400 });
  }

  // 🔒 Security: validate projectKey if provided
  if (projectKey && !isValidProjectKey(projectKey)) {
    return NextResponse.json({ error: 'Invalid projectKey format' }, { status: 400 });
  }

  // Validate provider/model/effort overrides
  const normalizedProvider = (typeof providerOverride === 'string' ? providerOverride.trim() : '') as ProviderId;
  if (providerOverride !== undefined && !ALLOWED_PROVIDERS.includes(normalizedProvider)) {
    return NextResponse.json({ error: 'Invalid providerOverride' }, { status: 400 });
  }
  const normalizedModel = typeof modelOverride === 'string' ? modelOverride.trim() : '';
  if (modelOverride !== undefined && (!normalizedModel || normalizedModel.length > 200)) {
    return NextResponse.json({ error: 'Invalid modelOverride (1-200 chars)' }, { status: 400 });
  }
  const normalizedEffort = typeof effortOverride === 'string' ? effortOverride.trim() as OpenAIReasoningEffort : undefined;
  if (effortOverride !== undefined && !ALLOWED_OPENAI_EFFORTS.includes(normalizedEffort!)) {
    return NextResponse.json({ error: 'Invalid effortOverride (low|medium|high|xhigh)' }, { status: 400 });
  }

  const sessionId = requestedSessionId || generateSessionId();

  try {
    // Build flowContext when projectKey is present
    let flowContext: FlowContext | undefined;
    if (projectKey) {
      await ensureFlowsMigrated();

      const flowDataPath = getFlowDataPath(projectKey);

      // Resolve project name from index
      let projectName = projectKey;
      try {
        const projectIndex = await readJsonFile<ProjectIndex>(getFlowIndexPath(), { projects: [] });
        const found = projectIndex.projects.find(p => p.key === projectKey);
        if (found) projectName = found.name;
      } catch { /* ignore */ }

      flowContext = {
        projectKey,
        projectName,
        flowDataPath,
      };
    }

    const res = await sidecarFetch('/agent-chat/start', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        agentId,
        message,
        flowContext,
        images: validatedImages,
        initialTitle,
        config,
        parentSessionId,
        providerOverride: normalizedProvider || undefined,
        modelOverride: normalizedModel || undefined,
        effortOverride: normalizedEffort || undefined,
        depth: typeof depth === 'number' ? depth : undefined,
      }),
    });
    const data = await res.json() as { runId?: string; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Sidecar error' }, { status: res.status });
    }
    return NextResponse.json({ runId: data.runId, sessionId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
