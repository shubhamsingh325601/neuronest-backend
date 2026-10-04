import { BadRequestException, Injectable } from '@nestjs/common';
import { PlanStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { addDays, parseDateOnly } from '@modules/progress/shared/date.util';
import { assertChildProgressAccess } from '@modules/progress/shared/progress-access';
import { BACKFILL_WINDOW_DAYS } from '@modules/progress/shared/progress.constants';
import { ProgressEntryDto } from '@modules/progress/shared/progress.dto';
import { UpsertProgressDto } from './dto/upsert-progress.dto';

interface ProgressValues {
  mood: number | null;
  behaviour: number | null;
  sleepMinutes: number | null;
  note: string | null;
}

/**
 * Idempotent per-day upsert (plan 0013 §3 rows 2–5). Progress is plan-independent:
 * `planId` is stamped with the child's ACTIVE plan (if any) on first write and left alone
 * afterwards. Only the child's own PARENT may write.
 */
@Injectable()
export class UpsertProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    childId: string,
    entryDate: string,
    caller: AuthenticatedUser,
    dto: UpsertProgressDto,
    now: Date = new Date(),
  ): Promise<{ created: boolean; entry: ProgressEntryDto }> {
    await assertChildProgressAccess(this.prisma, childId, caller, 'write');

    if (
      dto.mood === undefined &&
      dto.behaviour === undefined &&
      dto.sleepMinutes === undefined &&
      dto.note === undefined
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide at least one of mood, behaviour, sleepMinutes or note.',
      });
    }

    const date = parseDateOnly(entryDate);
    const today = parseDateOnly(now.toISOString().slice(0, 10));
    if (date < addDays(today, -BACKFILL_WINDOW_DAYS)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `entryDate must not be more than ${BACKFILL_WINDOW_DAYS} days in the past.`,
      });
    }

    const values: ProgressValues = {
      mood: dto.mood ?? null,
      behaviour: dto.behaviour ?? null,
      sleepMinutes: dto.sleepMinutes ?? null,
      note: dto.note ?? null,
    };
    const where = { childId_entryDate: { childId, entryDate: date } };

    const existing = await this.prisma.progressEntry.findUnique({ where });
    if (existing) {
      return { created: false, entry: await this.update(where, values) };
    }

    const activePlan = await this.prisma.plan.findFirst({
      where: { childId, status: PlanStatus.ACTIVE },
      select: { id: true },
    });
    try {
      const row = await this.prisma.progressEntry.create({
        data: {
          childId,
          entryDate: date,
          planId: activePlan?.id ?? null,
          createdById: caller.id,
          ...values,
        },
      });
      return { created: true, entry: ProgressEntryDto.from(row) };
    } catch (err) {
      // A concurrent retry created the row between our read and write: treat as an update.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { created: false, entry: await this.update(where, values) };
      }
      throw err;
    }
  }

  private async update(
    where: Prisma.ProgressEntryWhereUniqueInput,
    values: ProgressValues,
  ): Promise<ProgressEntryDto> {
    return ProgressEntryDto.from(await this.prisma.progressEntry.update({ where, data: values }));
  }
}
