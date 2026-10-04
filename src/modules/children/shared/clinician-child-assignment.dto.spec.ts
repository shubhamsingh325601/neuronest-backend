import { Role } from '@prisma/client';
import { ClinicianChildAssignmentDto } from './clinician-child-assignment.dto';

const row = {
  id: 'a1',
  clinicianId: 'cl1',
  childId: 'c1',
  assignedByAdminId: 'admin-1',
  createdAt: new Date(),
} as never;

describe('ClinicianChildAssignmentDto audience (B-10)', () => {
  it('omits assignedByAdminId for a PARENT', () => {
    expect(ClinicianChildAssignmentDto.from(row, { audience: Role.PARENT })).not.toHaveProperty(
      'assignedByAdminId',
    );
  });

  it.each([Role.CLINICIAN, Role.ADMIN, undefined])('keeps it for %s', (audience) => {
    expect(ClinicianChildAssignmentDto.from(row, { audience }).assignedByAdminId).toBe('admin-1');
  });
});
