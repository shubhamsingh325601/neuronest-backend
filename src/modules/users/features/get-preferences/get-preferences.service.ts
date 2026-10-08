import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { PreferencesDto } from '@modules/users/shared/preferences.dto';

@Injectable()
export class GetPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<PreferencesDto> {
    const row = await this.prisma.userPreference.findUnique({ where: { userId } });
    return PreferencesDto.from(row);
  }
}