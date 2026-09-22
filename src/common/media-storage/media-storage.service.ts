import { MediaType } from '@prisma/client';

export interface CreateUploadTicketInput {
  mediaId: string;
  childId: string;
  type: MediaType;
}

export interface CreateUploadTicketResult {
  /** Opaque provider-shaped key. The only storage detail ever persisted on `Media`. */
  storageKey: string;
  /** Deliberately opaque/provider-shaped — the client passes this straight to the provider's upload call. */
  uploadParams: Record<string, unknown>;
}

/**
 * Provider-agnostic media storage contract. Injected by this abstract class as the DI
 * token; bound to {@link CloudinaryMediaStorageService} in production and to an
 * in-memory fake in tests — same pattern as `EmailService`.
 */
export abstract class MediaStorageService {
  /** Mint a signed upload ticket. Local signing only — no network call. */
  abstract createUploadTicket(input: CreateUploadTicketInput): Promise<CreateUploadTicketResult>;

  /** Confirm the asset actually landed at the provider before trusting a client's self-reported `confirm` body. */
  abstract verifyUpload(storageKey: string, type: MediaType): Promise<boolean>;
}
