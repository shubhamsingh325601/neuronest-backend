import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { MonthlyCallLogDto } from '@modules/call-logs/shared/monthly-call-log.dto';
import { LogCallDto } from './dto/log-call.dto';

/**
 * CLINICIAN(assigned)/ADMIN logs a monthly check-in call with a child's parent —
 * append-only, same "working paper" framing as `PlanNote`. Scoping walks directly from
 * `MonthlyCallLog.childId` (same existence-check shape as `media:read`, not the
 * `plan-note`-through-`Plan` shape, since this hangs directly off `Child`). `PARENT`
 * does not hold `monthly-call:create` at all — see docs/rbac.md.
 */
@Injectable()
export class LogCallService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    childId: string,
    caller: AuthenticatedUser,
    dto: LogCallDto,
  ): Promise<MonthlyCallLogDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }

    if (caller.role === Role.CLINICIAN) {
      const assignment = await this.prisma.clinicianChildAssignment.findUnique({
        where: { clinicianId_childId: { clinicianId: caller.id, childId } },
        select: { id: true },
      });
      if (!assignment) {
        throw this.forbidden();
      }
    }
    // ADMIN: no check. PARENT does not hold monthly-call:create.

    const log = await this.prisma.monthlyCallLog.create({
      data: {
        childId,
        clinicianId: caller.id,
        calledAt: new Date(dto.calledAt),
        notes: dto.notes,
      },
    });
    return MonthlyCallLogDto.from(log);
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}
