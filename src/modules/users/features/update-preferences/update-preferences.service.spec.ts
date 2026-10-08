import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { GetPreferencesService } from '../get-preferences/get-preferences.service';
import { UpdatePreferencesService } from './update-preferences.service';

describe('Preferences services', () => {
  const prisma = { userPreference: { findUnique: jest.fn(), upsert: jest.fn() } };
  let getService: GetPreferencesService;
  let updateService: UpdatePreferencesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GetPreferencesService,
        UpdatePreferencesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    getService = moduleRef.get(GetPreferencesService);
    updateService = moduleRef.get(UpdatePreferencesService);
  });

  it('returns the defaults when nothing has been saved', async () => {
    prisma.userPreference.findUnique.mockResolvedValue(null);
    await expect(getService.get('u1')).resolves.toEqual({
      coachingInApp: true,
      coachingEmail: false,
      coachingWhatsapp: false,
      appointmentReminders: true,
      consultationArchive: true,
    });
  });

  it('upserts only the fields sent and returns the merged result', async () => {
    prisma.userPreference.upsert.mockResolvedValue({
      userId: 'u1',
      coachingInApp: true,
      coachingEmail: true,
      coachingWhatsapp: false,
      appointmentReminders: true,
      consultationArchive: true,
    });
    const result = await updateService.update('u1', { coachingEmail: true });
    expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: expect.objectContaining({ userId: 'u1', coachingEmail: true }),
      update: expect.objectContaining({ coachingEmail: true }),
    });
    expect(result.coachingEmail).toBe(true);
  });
});