import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianApplicationDto } from '@modules/clinicians/shared/clinician-application.dto';

@Injectable()
export class GetApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<ClinicianApplicationDto> {
    const row = await this.prisma.clinicianApplication.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        code: 'APPLICATION_NOT_FOUND',
        message: 'No clinician application with that id.',
      });
    }
    return ClinicianApplicationDto.from(row);
  }
}
