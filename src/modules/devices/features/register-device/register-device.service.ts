import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

/**
 * Remembers a phone's push token for the signed-in user. A token belongs to one user at a time, so
 * signing in on a shared phone moves it to the new account instead of notifying the previous one.
 */
@Injectable()
export class RegisterDeviceService {
  private readonly logger = new Logger(RegisterDeviceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, dto: RegisterDeviceDto): Promise<void> {
    const platform = dto.platform ?? 'android';
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform },
      update: { userId, platform, lastSeenAt: new Date() },
    });
    // Never the token itself: it is the address of the phone.
    this.logger.log({ platform }, 'push device registered');
  }
}
