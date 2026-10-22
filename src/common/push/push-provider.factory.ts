import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ServiceAccount } from 'firebase-admin/app';
import type { AppConfig } from '@common/config/configuration';
import type { PrismaService } from '@common/prisma/prisma.service';
import { FcmPushService } from './fcm-push.service';
import { NoopPushService } from './noop-push.service';
import type { PushService } from './push.service';

/**
 * Builds the service account from the three env values; null when all are empty (push off). A partial
 * set throws naming what is missing. Hosts often paste the key with literal "\n" text instead of real
 * newlines, which is repaired here.
 */
export function readServiceAccount(
  projectId: string,
  clientEmail: string,
  privateKey: string,
): ServiceAccount | null {
  const values = {
    FIREBASE_PROJECT_ID: projectId.trim(),
    FIREBASE_CLIENT_EMAIL: clientEmail.trim(),
    FIREBASE_PRIVATE_KEY: privateKey.trim(),
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length === 3) {
    return null;
  }
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(', ')}`);
  }
  return {
    projectId: values.FIREBASE_PROJECT_ID,
    clientEmail: values.FIREBASE_CLIENT_EMAIL,
    privateKey: values.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

/** Binds the Firebase credentials to a {@link PushService}; without them pushes are skipped. */
export function createPushService(
  config: ConfigService<AppConfig, true>,
  prisma: PrismaService,
): PushService {
  const logger = new Logger('PushService');
  const { projectId, clientEmail, privateKey } = config.get('push', { infer: true });
  try {
    const serviceAccount = readServiceAccount(projectId, clientEmail, privateKey);
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
