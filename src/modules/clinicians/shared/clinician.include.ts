import { Prisma, VerificationTokenType } from '@prisma/client';

/**
 * Relations loaded for every clinician row. The invitation timestamps are *derived*
 * from the latest ACCOUNT_SETUP token (plan 0010 §3 row 11) — no `User` column.
 */
export const clinicianInclude = {
  verificationTokens: {
    where: { type: VerificationTokenType.ACCOUNT_SETUP },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true, expiresAt: true },
  },
} satisfies Prisma.UserInclude;

export const clinicianDetailInclude = {
  ...clinicianInclude,
  clinicianProfile: true,
  clinicianAssignments: { select: { childId: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.UserInclude;

export type ClinicianRow = Prisma.UserGetPayload<{ include: typeof clinicianInclude }>;
export type ClinicianDetailRow = Prisma.UserGetPayload<{
  include: typeof clinicianDetailInclude;
}>;
