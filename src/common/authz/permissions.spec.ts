import { Role } from '@prisma/client';
import { PERMISSIONS, roleHasPermission } from './permissions';

describe('guided AI chat permission (plan 0019 section 10)', () => {
  it('is held by the parent, and by admin through the spread, and by nobody else', () => {
    expect(roleHasPermission(Role.PARENT, 'ai-chat:send:self')).toBe(true);
    expect(roleHasPermission(Role.ADMIN, 'ai-chat:send:self')).toBe(true);
    expect(roleHasPermission(Role.EXPERT, 'ai-chat:send:self')).toBe(false);
    expect(roleHasPermission(Role.CLINICIAN, 'ai-chat:send:self')).toBe(false);
  });

  it('is part of the declared permission list', () => {
    expect(PERMISSIONS).toContain('ai-chat:send:self');
  });
});
