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

export interface PlaybackUrlResult {
  url: string;
  /**
   * `null` when the account tier has no self-expiring-URL mechanism (see
   * `CloudinaryMediaStorageService` — this account is on the Free plan, which has no
   * token-based-authentication add-on). Never claim an expiry that isn't real.
   */
  expiresAt: string | null;
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

  /**
   * Mint a mediated playback URL for an `UPLOADED` asset. Minted fresh per request —
   * never persisted or cached on the `Media` row. Callers must treat the containing
   * HTTP response as `Cache-Control: no-store`.
   */
  abstract createPlaybackUrl(storageKey: string, type: MediaType): Promise<PlaybackUrlResult>;
}
