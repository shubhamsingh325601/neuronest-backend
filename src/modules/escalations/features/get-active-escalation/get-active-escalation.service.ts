import { Injectable, NotFoundException } from '@nestjs/common';
import { EscalationStatus } from '@prisma/client';
import { assertChildAccess } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { assignedClinicianName } from '@modules/escalations/shared/assigned-clinician';
import { EscalationDto } from '@modules/escalations/shared/escalation.dto';

@Injectable()
export class GetActiveEscalationService {
  constructor(private readonly prisma: PrismaService) {}

  async active(childId: string, caller: AuthenticatedUser): Promise<EscalationDto> {
    await assertChildAccess(this.prisma, childId, caller, 'read');
    const row = await this.prisma.escalation.findFirst({
      where: { childId, status: { in: [EscalationStatus.OPEN, EscalationStatus.ACKNOWLEDGED] } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'ESCALATION_NOT_FOUND',
        message: 'There is no active urgent-support request.',
      });
    }
    return EscalationDto.from(row, await assignedClinicianName(this.prisma, childId));
  }
}
