import { NextRequest, NextResponse } from 'next/server';
import { getArtifactSummaryPath, readJsonFile } from '@/lib/file-store';
import type { ArtifactSummary } from '@/types';

const DEFAULT_SUMMARY: ArtifactSummary = {
  planId: '',
  taskId: '',
  timestamp: '',
  changeType: 'unknown',
  filesChanged: [],
  artifacts: [],
};

/**
 * GET /api/artifacts
 * Return the artifact summary for a plan.
 * Query: ?planId=xxx
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const planId = searchParams.get('planId');

  if (!planId) {
    return NextResponse.json(
      { error: 'planId query param is required' },
      { status: 400 },
    );
  }

  const summaryPath = getArtifactSummaryPath(planId);
  const summary = await readJsonFile<ArtifactSummary>(summaryPath, DEFAULT_SUMMARY);

  // If summary has no planId, it means the file didn't exist
  if (!summary.planId) {
    return NextResponse.json(
      { error: 'Artifact summary not found' },
      { status: 404 },
    );
  }

  return NextResponse.json(summary);
}
