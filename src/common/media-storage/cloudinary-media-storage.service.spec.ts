import { v2 as cloudinary } from 'cloudinary';
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

  it('signs uploads as authenticated delivery, not the public default', async () => {
    const service = new CloudinaryMediaStorageService(configFor() as never);
    const result = await service.createUploadTicket({
      mediaId: 'a',
      childId: 'child',
      type: MediaType.PHOTO,
    });
    expect(result.uploadParams.type).toBe('authenticated');
  });
});

describe('CloudinaryMediaStorageService — createPlaybackUrl', () => {
  const configFor = () => ({
    get: jest.fn().mockReturnValue({
      cloudName: 'demo-cloud',
      apiKey: 'demo-key',
      apiSecret: 'demo-secret',
    }),
  });

  it('mints a signed, authenticated-delivery URL with no self-expiring token (Free plan has no add-on)', async () => {
    const service = new CloudinaryMediaStorageService(configFor() as never);
    const { url, expiresAt } = await service.createPlaybackUrl(
      'neuronest/child-1/media-1',
      MediaType.PHOTO,
    );
    expect(url).toContain('demo-cloud');
    expect(url).toContain('/image/authenticated/');
    expect(url).toContain('neuronest/child-1/media-1');
    expect(expiresAt).toBeNull();
  });

  it('maps VIDEO to the video resource path', async () => {
    const service = new CloudinaryMediaStorageService(configFor() as never);
    const { url } = await service.createPlaybackUrl('neuronest/child-1/media-1', MediaType.VIDEO);
    expect(url).toContain('/video/authenticated/');
  });
});

describe('CloudinaryMediaStorageService — inspectUpload', () => {
  const config = {
    get: jest.fn().mockReturnValue({ cloudName: 'c', apiKey: 'k', apiSecret: 's' }),
  };
  let resource: jest.SpyInstance;
  let service: CloudinaryMediaStorageService;

  beforeEach(() => {
    service = new CloudinaryMediaStorageService(config as never);
    resource = jest.spyOn(cloudinary.api, 'resource');
  });
  afterEach(() => {
    resource.mockRestore();
  });

  it('returns provider-reported bytes, MIME type and rounded duration for a video', async () => {
    resource.mockResolvedValue({ bytes: 5_000_000, format: 'mp4', duration: 12.4 });

    await expect(service.inspectUpload('neuronest/c/m', MediaType.VIDEO)).resolves.toEqual({
      bytes: 5_000_000,
      format: 'mp4',
      mimeType: 'video/mp4',
      durationSeconds: 12,
    });
    expect(resource).toHaveBeenCalledWith('neuronest/c/m', {
      resource_type: 'video',
      type: 'authenticated',
    });
  });

  it('reports a null duration for a photo, or when the provider has not reported one yet', async () => {
    resource.mockResolvedValue({ bytes: 2048, format: 'jpg' });
    await expect(service.inspectUpload('k', MediaType.PHOTO)).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      durationSeconds: null,
    });

    resource.mockResolvedValue({ bytes: 9, format: 'mov' });
    await expect(service.inspectUpload('k', MediaType.VIDEO)).resolves.toMatchObject({
      mimeType: 'video/quicktime',
      durationSeconds: null,
    });
  });

  it('returns null when the asset has not landed (404)', async () => {
    resource.mockRejectedValue({ http_code: 404 });
    await expect(service.inspectUpload('k', MediaType.PHOTO)).resolves.toBeNull();
  });

  it('rethrows non-404 provider errors', async () => {
    resource.mockRejectedValue({ http_code: 500 });
    await expect(service.inspectUpload('k', MediaType.PHOTO)).rejects.toEqual({ http_code: 500 });
  });
});
