export const ALLOWED_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type ImageMediaType = (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number];

export interface ImageAttachment {
  mediaType: ImageMediaType;
  data: string;
}

export interface NormalizeImageAttachmentsOptions {
  maxImages?: number;
  maxImageBytes?: number;
}

const DEFAULT_MAX_IMAGES = 5;
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function isImageMediaType(mediaType: string): mediaType is ImageMediaType {
  return (ALLOWED_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

export function imageAttachmentToDataUrl(image: ImageAttachment): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

export function imageAttachmentFromDataUrl(dataUrl: string): ImageAttachment {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) {
    throw new Error('Invalid image data URL');
  }

  const [, mediaType, data] = match;
  if (!isImageMediaType(mediaType)) {
    throw new Error(`Unsupported image type: ${mediaType}`);
  }

  return {
    mediaType,
    data,
  };
}

export function estimateBase64DecodedBytes(base64: string): number {
  const padding = (base64.match(/=*$/)?.[0].length ?? 0);
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function normalizeImageAttachments(
  images: Array<{ mediaType: string; data: string }> | undefined,
  options: NormalizeImageAttachmentsOptions = {},
): ImageAttachment[] | undefined {
  if (!Array.isArray(images) || images.length === 0) {
    return undefined;
  }

  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  if (images.length > maxImages) {
    throw new Error(`At most ${maxImages} images per message`);
  }

  return images.map((image) => {
    if (!isImageMediaType(image.mediaType)) {
      throw new Error(`Unsupported image type: ${image.mediaType}`);
    }

    if (typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(image.data)) {
      throw new Error('Invalid image data (must be base64)');
    }

    if (estimateBase64DecodedBytes(image.data) > maxImageBytes) {
      throw new Error(`Image too large (max ${Math.floor(maxImageBytes / (1024 * 1024))} MB per image)`);
    }

    return {
      mediaType: image.mediaType,
      data: image.data,
    };
  });
}

export function extensionForImageMediaType(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
  }
}
