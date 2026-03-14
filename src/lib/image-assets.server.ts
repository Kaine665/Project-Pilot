import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { ImageAttachment } from '@/lib/image-assets';
import { extensionForImageMediaType } from '@/lib/image-assets';

export async function writeImageAttachmentsToTempFiles(
  images: ImageAttachment[] | undefined,
  prefix = 'agent-img',
): Promise<string[]> {
  if (!images?.length) {
    return [];
  }

  const tempPaths: string[] = [];
  for (const image of images) {
    const tmpPath = join(tmpdir(), `${prefix}-${randomBytes(8).toString('hex')}.${extensionForImageMediaType(image.mediaType)}`);
    await writeFile(tmpPath, Buffer.from(image.data, 'base64'));
    tempPaths.push(tmpPath);
  }
  return tempPaths;
}

export async function cleanupTempImageFiles(paths: string[] | undefined): Promise<void> {
  if (!paths?.length) {
    return;
  }

  await Promise.allSettled(paths.map((filePath) => unlink(filePath)));
}
