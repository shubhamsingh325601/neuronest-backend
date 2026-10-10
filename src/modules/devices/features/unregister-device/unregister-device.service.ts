import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { UnregisterDeviceDto } from './dto/unregister-device.dto';

/** Stops push notifications to a phone, e.g. on sign-out. Only the user's own tokens; repeating it is harmless. */
@Injectable()
export class UnregisterDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async unregister(userId: string, dto: UnregisterDeviceDto): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token: dto.token } });
  }
}
