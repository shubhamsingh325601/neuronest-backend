import {
  MediaStorageService,
  type CreateUploadTicketInput,
  type CreateUploadTicketResult,
} from '@common/media-storage/media-storage.service';
import type { MediaType } from '@prisma/client';

/**
 * In-memory MediaStorageService used by e2e tests. `createUploadTicket` returns a
 * deterministic stub (no real Cloudinary call). `verifyUpload` defaults to "found" so
 * the happy UPLOADED-confirm path needs no setup — call `simulateMissing` to make a
 * specific storageKey report as not-landed, for the FAILED-outcome / trust-check tests.
 */
export class FakeMediaStorageService extends MediaStorageService {
  readonly tickets: CreateUploadTicketInput[] = [];
  private readonly missing = new Set<string>();

  async createUploadTicket(input: CreateUploadTicketInput): Promise<CreateUploadTicketResult> {
    this.tickets.push(input);
    const storageKey = `fake/${input.childId}/${input.mediaId}`;
    return {
      storageKey,
      uploadParams: { fake: true, storageKey, type: input.type },
    };
  }

  async verifyUpload(storageKey: string, _type: MediaType): Promise<boolean> {
    return !this.missing.has(storageKey);
  }

  simulateMissing(storageKey: string): void {
    this.missing.add(storageKey);
  }

  clear(): void {
    this.tickets.length = 0;
    this.missing.clear();
  }
}
