import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { encodeCursor } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { clinicianInclude } from '@modules/clinicians/shared/clinician.include';
import { ListCliniciansService } from './list-clinicians.service';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

const row = (id: string) => ({
  id,
  name: 'Dr. Sam Okafor',
  email: 'sam@clinic.example',
  role: Role.CLINICIAN,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  verificationTokens: [],
});

describe('ListCliniciansService', () => {
  const prisma = { user: { findMany: jest.fn() } };
  let service: ListCliniciansService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListCliniciansService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListCliniciansService);
  });

  it('filters to role CLINICIAN, defaults limit to 20, no cursor', async () => {
    prisma.user.findMany.mockResolvedValue([row(UUID_A)]);

    const res = await service.list({});

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: Role.CLINICIAN },
      include: clinicianInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
    expect(res.data).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });

  it('filters by status and a case-insensitive name/email substring', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.list({ status: UserStatus.INVITED, q: 'sam' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: Role.CLINICIAN,
          status: UserStatus.INVITED,
          OR: [
            { name: { contains: 'sam', mode: 'insensitive' } },
            { email: { contains: 'sam', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('derives the invitation timestamps from the latest account-setup token', async () => {
    const createdAt = new Date('2026-02-01T00:00:00Z');
    const expiresAt = new Date('2026-02-04T00:00:00Z');
    prisma.user.findMany.mockResolvedValue([
      { ...row(UUID_A), verificationTokens: [{ createdAt, expiresAt }] },
      row(UUID_B),
    ]);

    const res = await service.list({});

    expect(res.data[0]).toMatchObject({ invitationSentAt: createdAt, invitationExpiresAt: expiresAt });
    expect(res.data[1]).toMatchObject({ invitationSentAt: null, invitationExpiresAt: null });
  });

  it('over-fetches by one and returns a nextCursor when there is another page', async () => {
    prisma.user.findMany.mockResolvedValue([row(UUID_A), row(UUID_B)]);

    const res = await service.list({ limit: 1 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(res.data.map((r) => r.id)).toEqual([UUID_A]);
    expect(res.nextCursor).toBe(encodeCursor(UUID_A));
  });

  it('decodes the cursor and skips the anchor row', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.list({ cursor: encodeCursor(UUID_A) });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: UUID_A }, skip: 1 }),
    );
  });
});
