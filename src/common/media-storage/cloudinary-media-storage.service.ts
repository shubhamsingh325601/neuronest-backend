import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { MediaType } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import {
  MediaStorageService,
  type CreateUploadTicketInput,
  type CreateUploadTicketResult,
} from './media-storage.service';

const RESOURCE_TYPE: Record<MediaType, 'image' | 'video'> = {
  [MediaType.PHOTO]: 'image',
  [MediaType.VIDEO]: 'video',
};

/**
 * Real Cloudinary-backed implementation. `createUploadTicket` only signs params
 * locally (no network call) — the client uploads the bytes directly to Cloudinary
 * using the returned ticket. `verifyUpload` is the one call that hits Cloudinary's
 * Admin API, to confirm the asset actually landed before `confirm` trusts it.
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
    const paramsToSign = { timestamp, folder, public_id: input.mediaId };
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
      },
    };
  }

  async verifyUpload(storageKey: string, type: MediaType): Promise<boolean> {
    try {
      await cloudinary.api.resource(storageKey, { resource_type: RESOURCE_TYPE[type] });
      return true;
    } catch (err) {
      if (this.isNotFound(err)) {
        return false;
      }
      throw err;
    }
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
