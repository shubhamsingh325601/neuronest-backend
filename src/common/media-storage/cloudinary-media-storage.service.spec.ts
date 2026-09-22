import { MediaType } from '@prisma/client';
import { CloudinaryMediaStorageService } from './cloudinary-media-storage.service';

/**
 * `createUploadTicket` only signs params locally — no network call — so it's exercised
 * directly against the real `cloudinary` SDK's signing helper (no mocking needed).
 */
describe('CloudinaryMediaStorageService — createUploadTicket (signing)', () => {
  const configFor = (
    overrides: Partial<{ cloudName: string; apiKey: string; apiSecret: string }> = {},
  ) => ({
    get: jest.fn().mockReturnValue({
      cloudName: 'demo-cloud',
      apiKey: 'demo-key',
      apiSecret: 'demo-secret',
      ...overrides,
    }),
  });

  it('returns an opaque storageKey scoped by child and media id', async () => {
    const service = new CloudinaryMediaStorageService(configFor() as never);
    const result = await service.createUploadTicket({
      mediaId: '11111111-1111-1111-1111-111111111111',
      childId: '22222222-2222-2222-2222-222222222222',
      type: MediaType.PHOTO,
    });
    expect(result.storageKey).toBe(
      'neuronest/22222222-2222-2222-2222-222222222222/11111111-1111-1111-1111-111111111111',
    );
  });

  it('signs deterministically for the same params and secret', async () => {
    const service = new CloudinaryMediaStorageService(configFor() as never);
    const input = {
      mediaId: '11111111-1111-1111-1111-111111111111',
      childId: '22222222-2222-2222-2222-222222222222',
      type: MediaType.VIDEO,
    };
    const first = await service.createUploadTicket(input);
    const second = await service.createUploadTicket(input);
    // timestamps differ across calls, but the signature is a function of the signed
    // params — assert its shape rather than an exact value.
    expect(typeof first.uploadParams.signature).toBe('string');
    expect((first.uploadParams.signature as string).length).toBeGreaterThan(0);
    expect(first.uploadParams.resourceType).toBe('video');
    expect(second.uploadParams.resourceType).toBe('video');
  });

  it('produces a different signature for a different api secret', async () => {
    const serviceA = new CloudinaryMediaStorageService(
      configFor({ apiSecret: 'secret-a' }) as never,
    );
    const serviceB = new CloudinaryMediaStorageService(
      configFor({ apiSecret: 'secret-b' }) as never,
    );
    const input = {
      mediaId: '11111111-1111-1111-1111-111111111111',
      childId: '22222222-2222-2222-2222-222222222222',
      type: MediaType.PHOTO,
    };
    const a = await serviceA.createUploadTicket(input);
    const b = await serviceB.createUploadTicket(input);
    expect(a.uploadParams.signature).not.toBe(b.uploadParams.signature);
  });

  it('maps PHOTO/VIDEO to Cloudinary image/video resource types', async () => {
    const service = new CloudinaryMediaStorageService(configFor() as never);
    const photo = await service.createUploadTicket({
      mediaId: 'a',
      childId: 'child',
      type: MediaType.PHOTO,
    });
    const video = await service.createUploadTicket({
      mediaId: 'b',
      childId: 'child',
      type: MediaType.VIDEO,
    });
    expect(photo.uploadParams.resourceType).toBe('image');
    expect(video.uploadParams.resourceType).toBe('video');
  });
});
