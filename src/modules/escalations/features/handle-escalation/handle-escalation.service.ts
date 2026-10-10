import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EscalationStatus, Role } from '@prisma/client';
import { assertChildAccess } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { PushNotifier } from '@common/push/push-notifier';
import { assignedClinicianName } from '@modules/escalations/shared/assigned-clinician';
import { EscalationDto } from '@modules/escalations/shared/escalation.dto';
import { ResolveEscalationDto } from './dto/resolve-escalation.dto';

/**
 * Assigned clinician (or admin) works an escalation OPEN → ACKNOWLEDGED → RESOLVED. Both transitions
 * are idempotent; a CANCELLED request cannot be worked, and RESOLVED is final.
 */
@Injectable()
export class HandleEscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: PushNotifier,
  ) {}

  async acknowledge(id: string, caller: AuthenticatedUser): Promise<EscalationDto> {
    const { row, clinicianName } = await this.load(id, caller);
    if (row.status !== EscalationStatus.OPEN) {
      return EscalationDto.from(row, clinicianName);
    }
    const updated = await this.prisma.escalation.update({
      where: { id },
      data: {
        status: EscalationStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        handledById: caller.id,
      },
    });
    void this.notifier.toParent(row.childId, {
      title: 'Your request was seen',
      body: 'Your clinician has seen your urgent request.',
      data: { type: 'escalation_acknowledged', escalationId: id },
    });
    return EscalationDto.from(updated, clinicianName);
  }

  async resolve(
    id: string,
    caller: AuthenticatedUser,
    dto: ResolveEscalationDto,
  ): Promise<EscalationDto> {
    const { row, clinicianName } = await this.load(id, caller);
    if (row.status === EscalationStatus.RESOLVED) {
      return EscalationDto.from(row, clinicianName);
    }
    const updated = await this.prisma.escalation.update({
      where: { id },
      data: {
        status: EscalationStatus.RESOLVED,
        resolvedAt: new Date(),
        acknowledgedAt: row.acknowledgedAt ?? new Date(),
        handledById: caller.id,
        resolutionNote: dto.note?.trim() || null,
      },
    });
    void this.notifier.toParent(row.childId, {
      title: 'Your request was answered',
      body: 'Your clinician has responded to your urgent request.',
      data: { type: 'escalation_resolved', escalationId: id },
    });
    return EscalationDto.from(updated, clinicianName);
  }

  private async load(id: string, caller: AuthenticatedUser) {
    const row = await this.prisma.escalation.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'ESCALATION_NOT_FOUND', message: 'No such request.' });
    }
    if (caller.role === Role.PARENT) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
    await assertChildAccess(this.prisma, row.childId, caller, 'read');
    if (row.status === EscalationStatus.CANCELLED) {
      throw new ConflictException({
        code: 'ESCALATION_CANCELLED',
        message: 'The parent cancelled this request.',
      });
    }
    return { row, clinicianName: await assignedClinicianName(this.prisma, row.childId) };
  }
}
