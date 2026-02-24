import { NextRequest, NextResponse } from 'next/server';
import { plannerManager, generateSessionId } from '@/lib/planner-manager';
import { getFlowDataPath, readJsonFile } from '@/lib/file-store';
import type { FlowData } from '@/types/flow';
import fs from 'fs/promises';
import path from 'path';

const FLOWS_DIR = path.join(process.cwd(), 'src/data/flows');
const INDEX_PATH = path.join(FLOWS_DIR, '_index.json');

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

  if (!projectKey || !message) {
    return NextResponse.json(
      { error: 'projectKey and message are required' },
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
    // Load flow data for the project
    const flowData = await readJsonFile<FlowData>(
      getFlowDataPath(projectKey),
      { sections: [] },
    );

    // Load project list
    let projectIndex: ProjectIndex = { projects: [] };
    try {
      const raw = await fs.readFile(INDEX_PATH, 'utf-8');
      projectIndex = JSON.parse(raw);
    } catch {
      // ignore
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
