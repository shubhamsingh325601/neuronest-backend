import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ServiceAccount } from 'firebase-admin/app';
import type { AppConfig } from '@common/config/configuration';
import type { PrismaService } from '@common/prisma/prisma.service';
import { FcmPushService } from './fcm-push.service';
import { NoopPushService } from './noop-push.service';
import type { PushService } from './push.service';

/** Reads the service account from raw JSON, base64 JSON, or a file path; null when none is set. */
export function readServiceAccount(json: string, path: string): ServiceAccount | null {
  const text = json.trim();
  if (text) {
    return JSON.parse(text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8'));
  }
  if (path.trim()) {
    return JSON.parse(readFileSync(path.trim(), 'utf8'));
  }
  return null;
}

/** Binds the Firebase credentials to a {@link PushService}; without them pushes are skipped. */
export function createPushService(
  config: ConfigService<AppConfig, true>,
  prisma: PrismaService,
): PushService {
  const logger = new Logger('PushService');
  const { serviceAccountJson, serviceAccountPath } = config.get('push', { infer: true });
  try {
    const serviceAccount = readServiceAccount(serviceAccountJson, serviceAccountPath);
    if (serviceAccount) {
      return new FcmPushService(prisma, serviceAccount);
    }
  } catch (err) {
    logger.error(
      `Firebase credentials could not be read, push is off: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  logger.warn('Firebase is not configured: push notifications are skipped.');
  return new NoopPushService();
}
