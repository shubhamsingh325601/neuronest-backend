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
  // Enforced by the admin clinician-application review routes (Phase 3).
  'clinician-application:list',
  'clinician-application:review',
  // Core Care Domain (Phase 4). Ownership/assignment scoping for `child:read` is
  // enforced in the service, not here — see docs/rbac.md.
  'child:create:self',
  'child:read',
  'clinician-child:manage',
  // Media upload (Phase 5). `media:read` scoping (parent-own / clinician-assigned /
  // admin-any) is the same shape as `child:read` — enforced in the service.
  'media:create:self',
  'media:read',
  // Plan domain (Phase 6). `plan-template:read` and `plan:manage`/`plan:read` scoping
  // is enforced in the service — see docs/rbac.md decision notes for the two new
  // scoping *shapes* this phase introduces (query-filter, and note-visibility
  // withheld from a role that already holds `plan:read`).
  'plan-template:manage',
  'plan-template:read',
  'plan:manage',
  'plan:read',
  'plan-note:create',
  'plan-note:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SELF_PERMISSIONS: Permission[] = ['user:read:self', 'user:deactivate:self'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.PARENT]: [
    ...SELF_PERMISSIONS,
    'child:create:self',
    'child:read',
    'media:create:self',
    'media:read',
    'plan:read',
  ],
  [Role.CLINICIAN]: [
    ...SELF_PERMISSIONS,
    'child:read',
    'media:read',
    'plan-template:read',
    'plan:manage',
    'plan:read',
    'plan-note:create',
    'plan-note:read',
  ],
  [Role.ADMIN]: [...PERMISSIONS],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
