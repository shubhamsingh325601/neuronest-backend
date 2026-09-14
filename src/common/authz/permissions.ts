import { Role } from '@prisma/client';

/**
 * Static permission catalogue for Phase 1.
 *
 * Only the permissions actually enforced by a route this phase are listed. When rules
 * become conditional / ownership-based across domains, this same map feeds a
 * `@casl/ability` factory — see docs/rbac.md. No schema change is needed to get there.
 */
export const PERMISSIONS = [
  'user:read:self',
  'user:deactivate:self',
  // Declared for the admin review flow that lands in a later phase; unused by any
  // route right now, but keeps ADMIN's grant list honest.
  'clinician-application:list',
  'clinician-application:review',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SELF_PERMISSIONS: Permission[] = ['user:read:self', 'user:deactivate:self'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.PARENT]: [...SELF_PERMISSIONS],
  [Role.CLINICIAN]: [...SELF_PERMISSIONS],
  [Role.ADMIN]: [...PERMISSIONS],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
