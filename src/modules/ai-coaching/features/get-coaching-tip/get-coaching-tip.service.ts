import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { AiAccessService } from '@modules/ai-coaching/shared/ai-access.service';
import { COACHING_TIP_CAPABILITY } from '@modules/ai-coaching/shared/ai-coaching.constants';
import { AiCoachingTipDto } from '@modules/ai-coaching/shared/ai-coaching-tip.dto';
import { formatDateOnly, parseDateOnly } from '@modules/progress/shared/date.util';

/**
 * Side-effect-free read of today's stored tip (plan 0018 §5): the poll target after a `202`, and
 * the clinician/admin view of what the parent was told. It never calls the provider and never
 * writes. Access is the `child:read` shape via `GetChildService` (parent-own, clinician-assigned,
 * admin-any).
 */
@Injectable()
export class GetCoachingTipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiAccessService,
  ) {}

  async getToday(
    childId: string,
    caller: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<AiCoachingTipDto> {
    await this.access.getChildForRead(childId, caller);
    const forDateText = formatDateOnly(now);

    if (!this.access.enabled) {
      return AiCoachingTipDto.unavailable(forDateText, 'DISABLED');
    }

    const row = await this.prisma.aiOutput.findUnique({
      where: {
        childId_capability_forDate: {
          childId,
          capability: COACHING_TIP_CAPABILITY,
          forDate: parseDateOnly(forDateText),
        },
      },
    });
    return row ? AiCoachingTipDto.fromRow(row, forDateText, now) : AiCoachingTipDto.none(forDateText);
  }
}
