import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { PreferencesDto } from '@modules/users/shared/preferences.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

/** Idempotent: only the fields sent change; the first save creates the row from the defaults. */
@Injectable()
export class UpdatePreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async update(userId: string, dto: UpdatePreferencesDto): Promise<PreferencesDto> {
    const changes = {
      coachingInApp: dto.coachingInApp,
      coachingEmail: dto.coachingEmail,
      coachingWhatsapp: dto.coachingWhatsapp,
      appointmentReminders: dto.appointmentReminders,
      consultationArchive: dto.consultationArchive,
    };
    const row = await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...changes },
      update: changes,
    });
    return PreferencesDto.from(row);
  }
}