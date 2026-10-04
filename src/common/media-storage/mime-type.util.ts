type ResourceType = 'image' | 'video';

const MIME_BY_FORMAT: Record<ResourceType, Record<string, string>> = {
  video: {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mpeg: 'video/mpeg',
    '3gp': 'video/3gpp',
  },
  image: {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
  },
};

/**
 * MIME type for a provider-reported `format` (e.g. Cloudinary's `format: "mov"`).
 * Common formats come from a lookup table; anything else falls back to
 * `${resourceType}/${format}`.
 */
export function mimeTypeFor(resourceType: ResourceType, format: string): string {
  const normalised = format.toLowerCase();
  return MIME_BY_FORMAT[resourceType][normalised] ?? `${resourceType}/${normalised}`;
}
