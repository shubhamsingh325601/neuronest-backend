import { mimeTypeFor } from './mime-type.util';

describe('mimeTypeFor', () => {
  it.each([
    ['video', 'mp4', 'video/mp4'],
    ['video', 'mov', 'video/quicktime'],
    ['video', 'webm', 'video/webm'],
    ['video', 'avi', 'video/x-msvideo'],
    ['image', 'jpg', 'image/jpeg'],
    ['image', 'jpeg', 'image/jpeg'],
    ['image', 'png', 'image/png'],
    ['image', 'gif', 'image/gif'],
    ['image', 'webp', 'image/webp'],
    ['image', 'heic', 'image/heic'],
  ] as const)('maps %s/%s to %s', (resourceType, format, expected) => {
    expect(mimeTypeFor(resourceType, format)).toBe(expected);
  });

  it('is case-insensitive on the format', () => {
    expect(mimeTypeFor('image', 'JPG')).toBe('image/jpeg');
  });

  it('falls back to resource_type/format for an unknown format', () => {
    expect(mimeTypeFor('video', 'mkv')).toBe('video/mkv');
    expect(mimeTypeFor('image', 'avif')).toBe('image/avif');
  });
});
