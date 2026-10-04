import { PrismaService } from '@common/prisma/prisma.service';
import { ConsentRecordDto, ConsentStateDto } from './consent.dto';

export const CONSENT_HISTORY_LIMIT = 50;

/**
 * Current consent state for a child. The "current" row is the open one (neither withdrawn
 * nor superseded); with none open, the status is WITHDRAWN if any grant in the window was
 * withdrawn, else NONE.
 */
export async function loadConsentState(
  prisma: PrismaService,
  childId: string,
): Promise<ConsentStateDto> {
  const rows = await prisma.mediaConsent.findMany({
    where: { childId },
    orderBy: [{ grantedAt: 'desc' }, { createdAt: 'desc' }],
    take: CONSENT_HISTORY_LIMIT,
  });
  const open = rows.find((r) => r.withdrawnAt === null && r.supersededAt === null) ?? null;
  const status = open ? 'GRANTED' : rows.some((r) => r.withdrawnAt !== null) ? 'WITHDRAWN' : 'NONE';
  return {
    status,
    current: open ? ConsentRecordDto.from(open) : null,
    history: rows.map((r) => ConsentRecordDto.from(r)),
  };
}
