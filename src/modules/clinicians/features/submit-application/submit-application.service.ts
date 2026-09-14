import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreateApplicationDto, CreateApplicationResponseDto } from './dto/create-application.dto';

/**
 * Captures a clinician application as a PENDING lead for later admin review.
 * Intentionally minimal — no account, no auth, no email. The documented multi-step
 * version (credentials upload, verification) is a later phase. The row is a
 * `ClinicianApplication` (see docs/schema-decisions.md).
 */
@Injectable()
export class SubmitApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(dto: CreateApplicationDto): Promise<CreateApplicationResponseDto> {
    const application = await this.prisma.clinicianApplication.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.toLowerCase().trim(),
        context: dto.context.trim(),
      },
      select: { id: true, status: true },
    });
    return application;
  }
}
