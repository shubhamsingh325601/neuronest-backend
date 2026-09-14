import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClinicianApplicationStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianApplicationDto } from '@modules/clinicians/shared/clinician-application.dto';
import {
  RejectApplicationDto,
  RejectApplicationResponseDto,
} from './dto/reject-application.dto';

/**
 * Admin rejects a clinician application.
 *
 * - Missing → 404 `APPLICATION_NOT_FOUND`.
 * - Already `APPROVED` → 409 `APPLICATION_DECISION_FINAL`.
 * - Already `REJECTED` → idempotent no-op (the stored `reviewNote` is not overwritten).
 * - `PENDING` / `REVIEWED` → set `REJECTED` and store the optional trimmed reason.
 */
@Injectable()
export class RejectApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async reject(
    id: string,
    dto: RejectApplicationDto,
  ): Promise<RejectApplicationResponseDto> {
    const application = await this.prisma.clinicianApplication.findUnique({ where: { id } });
    if (!application) {
      throw new NotFoundException({
        code: 'APPLICATION_NOT_FOUND',
        message: 'No clinician application with that id.',
      });
    }

    if (application.status === ClinicianApplicationStatus.APPROVED) {
      throw new ConflictException({
        code: 'APPLICATION_DECISION_FINAL',
        message: 'This application was already approved; reversing that is a manual step.',
      });
    }

    if (application.status === ClinicianApplicationStatus.REJECTED) {
      return { application: ClinicianApplicationDto.from(application) };
    }

    const updated = await this.prisma.clinicianApplication.update({
      where: { id },
      data: {
        status: ClinicianApplicationStatus.REJECTED,
        reviewNote: dto.reason?.trim() || null,
      },
    });
    return { application: ClinicianApplicationDto.from(updated) };
  }
}
