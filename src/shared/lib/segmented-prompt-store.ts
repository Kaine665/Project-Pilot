/**
 * Segmented Prompt Store — CRUD + concatenation for segmented prompts.
 *
 * Each prompt scope (global / project) can be split into a directory of segments:
 *   {base}.d/_index.json  — metadata index (SegmentedPromptIndex)
 *   {base}.d/{segmentId}.md  — individual segment content
 *
 * When the .d/ directory exists and contains a valid _index.json, the loader
 * concatenates all enabled segments in order. Otherwise it falls back to the
 * single .md file (backward compatible).
 */

import { promises as fs } from 'fs';
import {
  getSegmentedPromptDir,
  getSegmentedPromptIndexPath,
  getSegmentFilePath,
  readJsonFile,
  writeJsonFile,
} from './file-store';
import type {
  PromptSegmentScope,
  PromptSegment,
  SegmentedPromptIndex,
} from '@/types';
import { assertDocumentTextWritable } from './document-text-write-guard';

// ── Query helpers ──

/**
 * Check whether a scope uses segmented mode (i.e. the .d/ directory exists
 * with a valid _index.json).
 */
export async function isSegmented(scope: PromptSegmentScope): Promise<boolean> {
  try {
    await fs.stat(getSegmentedPromptIndexPath(scope));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the segment index for a scope. Returns { segments: [] } if not segmented.
 */
export async function readSegmentIndex(
  scope: PromptSegmentScope,
): Promise<SegmentedPromptIndex> {
  return readJsonFile<SegmentedPromptIndex>(
    getSegmentedPromptIndexPath(scope),
    { segments: [] },
  );
}

/**
 * Read the content of a single segment.
 */
export async function readSegmentContent(
  scope: PromptSegmentScope,
  segmentId: string,
): Promise<string> {
  try {
    return await fs.readFile(getSegmentFilePath(scope, segmentId), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Concatenate all enabled segments in order, separated by double newlines.
 * Returns undefined if not in segmented mode (caller should fallback to .md).
 */
export async function resolveSegmentedContent(
  scope: PromptSegmentScope,
): Promise<string | undefined> {
  if (!(await isSegmented(scope))) return undefined;

  const index = await readSegmentIndex(scope);
  const enabledSegments = index.segments.filter(s => s.enabled);
  if (enabledSegments.length === 0) return '';

  const parts = await Promise.all(
    enabledSegments.map(s => readSegmentContent(scope, s.id)),
  );
  return parts.filter(Boolean).join('\n\n');
}

// ── Mutation helpers ──

/**
 * Write the segment index (overwrites _index.json).
 */
async function writeSegmentIndex(
  scope: PromptSegmentScope,
  index: SegmentedPromptIndex,
): Promise<void> {
  await fs.mkdir(getSegmentedPromptDir(scope), { recursive: true });
  await writeJsonFile(getSegmentedPromptIndexPath(scope), index);
}

/**
 * Initialize segmented mode for a scope. If there's an existing single .md
 * file, it becomes the first segment ("original"). Creates the .d/ directory
 * and _index.json.
 *
 * Idempotent: if already segmented, returns the existing index.
 */
export async function initSegmented(
  scope: PromptSegmentScope,
  existingContent?: string,
): Promise<SegmentedPromptIndex> {
  if (await isSegmented(scope)) {
    return readSegmentIndex(scope);
  }

  const dir = getSegmentedPromptDir(scope);
  await fs.mkdir(dir, { recursive: true });

  const segments: PromptSegment[] = [];

  if (existingContent && existingContent.trim()) {
    const initialId = 'original';
    segments.push({
      id: initialId,
      title: '原始内容',
      description: '从单文件模式迁移的原始 prompt 内容',
      enabled: true,
    });
    assertDocumentTextWritable(existingContent);
    await fs.writeFile(getSegmentFilePath(scope, initialId), existingContent, 'utf-8');
  }

  const index: SegmentedPromptIndex = { segments };
  await writeSegmentIndex(scope, index);
  return index;
}

/**
 * Create a new segment. Appends to the end of the index by default.
 */
export async function createSegment(
  scope: PromptSegmentScope,
  segment: PromptSegment,
  content: string,
): Promise<SegmentedPromptIndex> {
  const index = await readSegmentIndex(scope);

  // Prevent duplicate IDs
  if (index.segments.some(s => s.id === segment.id)) {
    throw new Error(`Segment already exists: ${segment.id}`);
  }

  if (segment.title.trim()) assertDocumentTextWritable(segment.title);
  if (segment.description?.trim()) assertDocumentTextWritable(segment.description);

  index.segments.push(segment);
  await writeSegmentIndex(scope, index);
  await fs.mkdir(getSegmentedPromptDir(scope), { recursive: true });
  assertDocumentTextWritable(content);
  await fs.writeFile(getSegmentFilePath(scope, segment.id), content, 'utf-8');
  return index;
}

/**
 * Update segment metadata (title, description, enabled).
 * Does NOT touch the .md content — use updateSegmentContent for that.
 */
export async function updateSegmentMeta(
  scope: PromptSegmentScope,
  segmentId: string,
  patch: Partial<Pick<PromptSegment, 'title' | 'description' | 'enabled'>>,
): Promise<SegmentedPromptIndex> {
  const index = await readSegmentIndex(scope);
  const seg = index.segments.find(s => s.id === segmentId);
  if (!seg) throw new Error(`Segment not found: ${segmentId}`);

  if (patch.title !== undefined) {
    if (patch.title.trim()) assertDocumentTextWritable(patch.title);
    seg.title = patch.title;
  }
  if (patch.description !== undefined) {
    if (patch.description.trim()) assertDocumentTextWritable(patch.description);
    seg.description = patch.description;
  }
  if (patch.enabled !== undefined) seg.enabled = patch.enabled;

  await writeSegmentIndex(scope, index);
  return index;
}

/**
 * Update the content of a segment .md file.
 */
export async function updateSegmentContent(
  scope: PromptSegmentScope,
  segmentId: string,
  content: string,
): Promise<void> {
  // Verify the segment exists in the index
  const index = await readSegmentIndex(scope);
  if (!index.segments.some(s => s.id === segmentId)) {
    throw new Error(`Segment not found: ${segmentId}`);
  }
  assertDocumentTextWritable(content);
  await fs.writeFile(getSegmentFilePath(scope, segmentId), content, 'utf-8');
}

/**
 * Delete a segment (removes from index + deletes .md file).
 */
export async function deleteSegment(
  scope: PromptSegmentScope,
  segmentId: string,
): Promise<SegmentedPromptIndex> {
  const index = await readSegmentIndex(scope);
  index.segments = index.segments.filter(s => s.id !== segmentId);
  await writeSegmentIndex(scope, index);

  // Best-effort delete the .md file
  try {
    await fs.unlink(getSegmentFilePath(scope, segmentId));
  } catch {
    // File may not exist
  }

  return index;
}

/**
 * Reorder segments. `orderedIds` is the full list of segment IDs in new order.
 * Any IDs not in the list are appended at the end.
 */
export async function reorderSegments(
  scope: PromptSegmentScope,
  orderedIds: string[],
): Promise<SegmentedPromptIndex> {
  const index = await readSegmentIndex(scope);
  const byId = new Map(index.segments.map(s => [s.id, s]));

  const reordered: PromptSegment[] = [];
  for (const id of orderedIds) {
    const seg = byId.get(id);
    if (seg) {
      reordered.push(seg);
      byId.delete(id);
    }
  }
  // Append any remaining segments not in the ordered list
  for (const seg of byId.values()) {
    reordered.push(seg);
  }

  index.segments = reordered;
  await writeSegmentIndex(scope, index);
  return index;
}

/**
 * Exit segmented mode: concatenate all enabled segments back into a single .md
 * file and remove the .d/ directory. Useful for "unsegment" operation.
 */
export async function flattenSegments(
  scope: PromptSegmentScope,
): Promise<string> {
  const content = (await resolveSegmentedContent(scope)) ?? '';
  const dir = getSegmentedPromptDir(scope);
  await fs.rm(dir, { recursive: true, force: true });
  return content;
}
