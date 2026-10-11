import { Prisma } from '@prisma/client';

/** Relations loaded for the admin expert detail view. */
export const expertDetailInclude = {
  expertAssignments: { select: { childId: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.UserInclude;

export type ExpertDetailRow = Prisma.UserGetPayload<{ include: typeof expertDetailInclude }>;
