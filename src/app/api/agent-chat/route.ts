import { NextRequest, NextResponse } from 'next/server';
import { agentChatManager, generateSessionId } from '@/lib/agent-chat-manager';
import type { FlowContext, ImageAttachment, ImageMediaType } from '@/lib/agent-chat-manager';
import { getFlowDataPath, getFlowIndexPath, readJsonFile, ensureFlowsMigrated } from '@/lib/file-store';
import { isValidProjectKey, isValidSessionId } from '@/lib/security';

interface ProjectIndex {
  projects: Array<{ key: string; name: string }>;
}

const ALLOWED_IMAGE_TYPES: ImageMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image (base64 decoded)

/**
 * POST /api/agent-chat
 * Start an agent chat conversation.
 * Body: { agentId, message, sessionId?, projectKey?, images?: [{mediaType, data}] }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { agentId, message, sessionId: requestedSessionId, projectKey, images, initialTitle } = body as {
    agentId: string;
    message: string;
    sessionId?: string;
    projectKey?: string;
    images?: Array<{ mediaType: string; data: string }>;
    initialTitle?: string;
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

    const runId = await agentChatManager.start(sessionId, agentId, message, flowContext, validatedImages, initialTitle);
    return NextResponse.json({ runId, sessionId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
