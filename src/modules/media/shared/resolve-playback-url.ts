import { Media, MediaStatus } from '@prisma/client';
import { MediaStorageService } from '@common/media-storage/media-storage.service';

/** `null` unless the row is `UPLOADED` — no point minting a playback URL for an asset that hasn't landed. */
export async function resolvePlaybackUrl(
  mediaStorage: MediaStorageService,
  row: Pick<Media, 'storageKey' | 'type' | 'status'>,
): Promise<string | null> {
  if (row.status !== MediaStatus.UPLOADED) {
    return null;
  }
  const { url } = await mediaStorage.createPlaybackUrl(row.storageKey, row.type);
  return url;
}
