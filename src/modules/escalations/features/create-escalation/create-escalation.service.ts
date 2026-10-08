import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertChildAccess } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { assignedClinicianName } from '@modules/escalations/shared/assigned-clinician';
import { ESCALATION_RESPONSE_MS } from '@modules/escalations/shared/escalation.constants';
import { EscalationDto } from '@modules/escalations/shared/escalation.dto';
import { CreateEscalationDto } from './dto/create-escalation.dto';

/**
 * A parent raises an urgent-support request. The "one active request per child" rule is a partial
 * unique index, so concurrent submissions cannot both succeed (P2002 → 409). Clinicians respond by
 * acknowledging / resolving it — there is no chat.
 */
@Injectable()
export class CreateEscalationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    childId: string,
    caller: AuthenticatedUser,
    dto: CreateEscalationDto,
    now: Date = new Date(),
  ): Promise<EscalationDto> {
    await assertChildAccess(this.prisma, childId, caller, 'parent-write');

    try {
      const row = await this.prisma.escalation.create({
        data: {
          childId,
          raisedById: caller.id,
          categoryId: dto.categoryId,
          notes: dto.notes.trim(),
          whatWasTried: dto.whatWasTried?.trim() || null,
          callbackPhone: dto.callbackPhone?.trim() || null,
          createdAt: now,
          dueAt: new Date(now.getTime() + ESCALATION_RESPONSE_MS),
        },
      });
      return EscalationDto.from(row, await assignedClinicianName(this.prisma, childId), now);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'ESCALATION_ALREADY_ACTIVE',
          message: 'There is already an active urgent-support request for this child.',
        });
      }
      throw err;
    }
  }
}
