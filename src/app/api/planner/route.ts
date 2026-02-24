import { NextRequest, NextResponse } from 'next/server';
import { plannerManager, generateSessionId } from '@/lib/planner-manager';
import { getFlowDataPath, getFlowIndexPath, readJsonFile, ensureFlowsMigrated } from '@/lib/file-store';
import { isValidProjectKey, isValidSessionId } from '@/lib/security';
import type { FlowData } from '@/types/flow';
import fs from 'fs/promises';

// 🔒 Security: Maximum JSON file size (10MB)
const MAX_JSON_SIZE = 10 * 1024 * 1024;

interface ProjectIndex {
  projects: Array<{ key: string; name: string }>;
}

/**
 * POST /api/planner
 * Start a planner conversation for a session.
 * Body: { projectKey: string, message: string, sessionId?: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectKey, message, sessionId: requestedSessionId } = body as {
    projectKey: string;
    message: string;
    sessionId?: string;
  };

  // 🔒 Security: validate required fields
  if (!projectKey || !message) {
    return NextResponse.json(
      { error: 'projectKey and message are required' },
      { status: 400 },
    );
  }

  // 🔒 Security: validate projectKey format
  if (!isValidProjectKey(projectKey)) {
    return NextResponse.json(
      { error: 'Invalid projectKey format' },
      { status: 400 },
    );
  }

  // 🔒 Security: validate message length
  if (typeof message !== 'string' || message.length < 1 || message.length > 10000) {
    return NextResponse.json(
      { error: 'message must be a string between 1 and 10000 characters' },
      { status: 400 },
    );
  }

  // 🔒 Security: validate sessionId if provided
  if (requestedSessionId && !isValidSessionId(requestedSessionId)) {
    return NextResponse.json(
      { error: 'Invalid sessionId format' },
      { status: 400 },
    );
  }

  const sessionId = requestedSessionId || generateSessionId();

  // Check for already-running process for this project
  const runningId = plannerManager.getRunningForProject(projectKey);
  if (runningId && runningId !== sessionId) {
    return NextResponse.json(
      { error: 'A planner process is already running', runningSessionId: runningId },
      { status: 409 },
    );
  }

  try {
    await ensureFlowsMigrated();

    // Load flow data for the project
    const flowData = await readJsonFile<FlowData>(
      getFlowDataPath(projectKey),
      { sections: [] },
    );

    // Load project list
    let projectIndex: ProjectIndex = { projects: [] };
    try {
      const indexPath = getFlowIndexPath();
      // 🔒 Security: check file size before reading
      const stats = await fs.stat(indexPath);
      if (stats.size > MAX_JSON_SIZE) {
        throw new Error(`Index file too large: ${stats.size} bytes`);
      }

      const raw = await fs.readFile(indexPath, 'utf-8');
      projectIndex = JSON.parse(raw);
    } catch {
      // ignore - use empty project list
    }

    const runId = await plannerManager.start(
      sessionId,
      projectKey,
      message,
      flowData,
      projectIndex.projects,
    );

    return NextResponse.json({ runId, sessionId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
