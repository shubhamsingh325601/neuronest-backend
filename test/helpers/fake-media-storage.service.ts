import {
  MediaStorageService,
  type CreateUploadTicketInput,
  type CreateUploadTicketResult,
  type PlaybackUrlResult,
  type UploadedAssetInfo,
} from '@common/media-storage/media-storage.service';
import type { MediaType } from '@prisma/client';

/** Default provider-reported facts for an asset that "landed" without further setup. */
const DEFAULT_ASSET: Record<MediaType, UploadedAssetInfo> = {
  PHOTO: { bytes: 2048, format: 'jpg', mimeType: 'image/jpeg', durationSeconds: null },
  VIDEO: { bytes: 8_000_000, format: 'mp4', mimeType: 'video/mp4', durationSeconds: 12 },
};

/**
 * In-memory MediaStorageService used by e2e tests. `createUploadTicket` returns a
 * deterministic stub (no real Cloudinary call). `inspectUpload` defaults to "landed"
 * with fixed provider-reported metadata so the happy UPLOADED-confirm path needs no
 * setup — call `simulateMissing` to make a storageKey report as not-landed (the
 * FAILED-outcome / trust-check tests), or `simulateAsset` to set its reported facts.
 */
export class FakeMediaStorageService extends MediaStorageService {
  readonly tickets: CreateUploadTicketInput[] = [];
  private readonly missing = new Set<string>();
  private readonly assets = new Map<string, UploadedAssetInfo>();

  async createUploadTicket(input: CreateUploadTicketInput): Promise<CreateUploadTicketResult> {
    this.tickets.push(input);
    const storageKey = `fake/${input.childId}/${input.mediaId}`;
    return {
      storageKey,
      uploadParams: { fake: true, storageKey, type: input.type },
    };
  }

  async inspectUpload(storageKey: string, type: MediaType): Promise<UploadedAssetInfo | null> {
    if (this.missing.has(storageKey)) {
      return null;
    }
    return this.assets.get(storageKey) ?? DEFAULT_ASSET[type];
  }

  async createPlaybackUrl(storageKey: string, _type: MediaType): Promise<PlaybackUrlResult> {
    return { url: `https://fake-cdn.example.com/${storageKey}`, expiresAt: null };
  }

  simulateMissing(storageKey: string): void {
    this.missing.add(storageKey);
  }

  simulateAsset(storageKey: string, info: UploadedAssetInfo): void {
    this.assets.set(storageKey, info);
  }

  clear(): void {
    this.tickets.length = 0;
    this.missing.clear();
    this.assets.clear();
  }
}
