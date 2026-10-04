import { Role } from '@prisma/client';
import { PlanDetailDto, PlanDto } from './plan.dto';

const row = {
  id: 'p1',
  childId: 'c1',
  planTemplateId: 't1',
  status: 'ACTIVE',
  origin: 'MANUAL',
  startDate: new Date('2026-10-01'),
  createdById: 'clinician-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  days: [],
  sections: [],
} as never;

describe('PlanDto audience (X-7)', () => {
  it('omits createdById for a PARENT', () => {
    const dto = PlanDto.from(row, { audience: Role.PARENT });
    expect(dto).not.toHaveProperty('createdById');
    expect(JSON.parse(JSON.stringify(dto))).not.toHaveProperty('createdById');
  });

  it.each([Role.CLINICIAN, Role.ADMIN, undefined])('keeps createdById for %s', (audience) => {
    expect(PlanDto.from(row, { audience }).createdById).toBe('clinician-1');
  });

  it('applies to the detail shape too', () => {
    expect(PlanDetailDto.fromWithContent(row, { audience: Role.PARENT })).not.toHaveProperty(
      'createdById',
    );
    expect(PlanDetailDto.fromWithContent(row, { audience: Role.ADMIN }).createdById).toBe(
      'clinician-1',
    );
  });
});
