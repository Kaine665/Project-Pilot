import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import pathModule from 'path';
import { getArtifactsDir } from '@/lib/file-store';

// 🔒 Security: Maximum file size for artifacts (10MB)
const MAX_ARTIFACT_SIZE = 10 * 1024 * 1024;

/**
 * GET /api/artifacts/[...path]
 * Serve artifact files (images, markdown, JSON).
 * The path segments form the file path under data/artifacts/.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;

  if (!pathSegments || pathSegments.length === 0) {
    return NextResponse.json({ error: 'File path is required' }, { status: 400 });
  }

  // Build the full file path under the artifacts directory
  const filePath = pathModule.join(getArtifactsDir(), ...pathSegments);

  // Security: ensure the resolved path is within the artifacts directory
  const resolvedPath = pathModule.resolve(filePath);
  const artifactsRoot = pathModule.resolve(getArtifactsDir());
  if (!resolvedPath.startsWith(artifactsRoot)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    // 🔒 Security: check file size before reading to prevent DoS
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_ARTIFACT_SIZE) {
      return NextResponse.json(
        { error: `File too large: ${stats.size} bytes (max ${MAX_ARTIFACT_SIZE})` },
        { status: 413 }
      );
    }

    const ext = pathModule.extname(filePath).toLowerCase();

    if (ext === '.png') {
      const buffer = await fs.readFile(filePath);
      return new NextResponse(buffer, {
        headers: { 'Content-Type': 'image/png' },
      });
    }

    if (ext === '.jpg' || ext === '.jpeg') {
      const buffer = await fs.readFile(filePath);
      return new NextResponse(buffer, {
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }

    if (ext === '.md') {
      const content = await fs.readFile(filePath, 'utf-8');
      return new NextResponse(content, {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      });
    }

    if (ext === '.json') {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return NextResponse.json(data);
    }

    // For other file types, serve as octet-stream
    const buffer = await fs.readFile(filePath);
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
