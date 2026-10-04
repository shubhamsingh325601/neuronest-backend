import { BadRequestException } from '@nestjs/common';

export const MAX_PLAN_DAY_NUMBER = 365;

/** Plan 0016 §3 row 11: a clinician may use any day 1..365, beyond the template's range. */
export function assertDayNumber(dayNumber: number): number {
  if (dayNumber < 1 || dayNumber > MAX_PLAN_DAY_NUMBER) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: `dayNumber must be between 1 and ${MAX_PLAN_DAY_NUMBER}.`,
    });
  }
  return dayNumber;
}
