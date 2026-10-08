import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EscalationStatus } from '@prisma/client';
import { assertChildAccess } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { assignedClinicianName } from '@modules/escalations/shared/assigned-clinician';
import { EscalationDto } from '@modules/escalations/shared/escalation.dto';

/** Parent withdraws an active request. Cancelling a cancelled one is a no-op; a resolved one is final. */
@Injectable()
export class CancelEscalationService {
  constructor(private readonly prisma: PrismaService) {}

  async cancel(id: string, caller: AuthenticatedUser): Promise<EscalationDto> {
    const row = await this.prisma.escalation.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'ESCALATION_NOT_FOUND', message: 'No such request.' });
    }
    await assertChildAccess(this.prisma, row.childId, caller, 'parent-write');
    const clinicianName = await assignedClinicianName(this.prisma, row.childId);

    if (row.status === EscalationStatus.CANCELLED) {
      return EscalationDto.from(row, clinicianName);
    }
    if (row.status === EscalationStatus.RESOLVED) {
      throw new ConflictException({
        code: 'ESCALATION_ALREADY_RESOLVED',
        message: 'This request has already been resolved.',
      });
    }
    const updated = await this.prisma.escalation.update({
      where: { id },
      data: { status: EscalationStatus.CANCELLED, cancelledAt: new Date() },
    });
    return EscalationDto.from(updated, clinicianName);
  }
}
