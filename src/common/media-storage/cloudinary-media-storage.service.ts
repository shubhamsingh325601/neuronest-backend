import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { MediaType } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import {
  MediaStorageService,
  type CreateUploadTicketInput,
  type CreateUploadTicketResult,
  type PlaybackUrlResult,
  type UploadedAssetInfo,
} from './media-storage.service';
import { mimeTypeFor } from './mime-type.util';

const RESOURCE_TYPE: Record<MediaType, 'image' | 'video'> = {
  [MediaType.PHOTO]: 'image',
  [MediaType.VIDEO]: 'video',
};

/** Authenticated delivery — never the public default. See class doc comment below. */
const DELIVERY_TYPE = 'authenticated' as const;

/**
 * Real Cloudinary-backed implementation. `createUploadTicket` only signs params
 * locally (no network call) — the client uploads the bytes directly to Cloudinary
 * using the returned ticket. `inspectUpload` is the one call that hits Cloudinary's
 * Admin API, to confirm the asset landed and read its real size / type / duration.
 *
 * Every asset is uploaded and read as `type: 'authenticated'` delivery (§3 row 7 of
 * plan 0008) — the default public delivery type never required a signature at all, so
 * a deterministic `storageKey` (`neuronest/{childId}/{mediaId}`) was fetchable by
 * anyone who could guess it. **Confirmed against this account** (`cloudinary.api.usage()`
 * → `plan: "Free"`, checked at implementation time per plan §7 step 2.0): the
 * token-based-authentication add-on (genuine time-boxed auto-expiry) requires a paid
 * add-on not available on Free. `createPlaybackUrl` therefore uses the documented
 * fallback (§3 row 8) — `sign_url: true` on an authenticated-delivery URL, which is
 * signature-valid but does **not** self-expire. `expiresAt` is honestly `null`, and
 * every consumer re-mints the URL fresh per request rather than persisting it.
 */
@Injectable()
export class CloudinaryMediaStorageService extends MediaStorageService {
  private readonly apiSecret: string;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    const { cloudName, apiKey, apiSecret } = config.get('cloudinary', { infer: true });
    this.apiSecret = apiSecret;
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  }

  async createUploadTicket(input: CreateUploadTicketInput): Promise<CreateUploadTicketResult> {
    const folder = `neuronest/${input.childId}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const resourceType = RESOURCE_TYPE[input.type];
    const paramsToSign = { timestamp, folder, public_id: input.mediaId, type: DELIVERY_TYPE };
    const signature = cloudinary.utils.api_sign_request(paramsToSign, this.apiSecret);

    return {
      storageKey: `${folder}/${input.mediaId}`,
      uploadParams: {
        cloudName: cloudinary.config().cloud_name,
        apiKey: cloudinary.config().api_key,
        timestamp,
        signature,
        folder,
        publicId: input.mediaId,
        resourceType,
        type: DELIVERY_TYPE,
      },
    };
  }

  async inspectUpload(storageKey: string, type: MediaType): Promise<UploadedAssetInfo | null> {
    const resourceType = RESOURCE_TYPE[type];
    try {
      const asset = (await cloudinary.api.resource(storageKey, {
        resource_type: resourceType,
        type: DELIVERY_TYPE,
      })) as { bytes: number; format: string; duration?: number };
      return {
        bytes: asset.bytes,
        format: asset.format,
        mimeType: mimeTypeFor(resourceType, asset.format),
        // Cloudinary may not report video duration immediately — null, never a guess.
        durationSeconds:
          resourceType === 'video' && typeof asset.duration === 'number'
            ? Math.round(asset.duration)
            : null,
      };
    } catch (err) {
      if (this.isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  async createPlaybackUrl(storageKey: string, type: MediaType): Promise<PlaybackUrlResult> {
    const url = cloudinary.utils.url(storageKey, {
      resource_type: RESOURCE_TYPE[type],
      type: DELIVERY_TYPE,
      sign_url: true,
      secure: true,
    });
    // Free plan has no token-based-authentication add-on (confirmed via
    // `cloudinary.api.usage()` at implementation time) — the signature above is
    // signature-valid but not time-boxed. Honest `null`, not a fake expiry.
    return { url, expiresAt: null };
  }

  private isNotFound(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'http_code' in err &&
      (err as { http_code?: number }).http_code === 404
    );
  }
}
