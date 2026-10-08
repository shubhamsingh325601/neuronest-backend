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
  // Admin-only directory of CLINICIAN users (picker + management screen). The
  // clinician-application permissions were removed in Phase 10.
  'clinician:list',
  // Admin-created clinician lifecycle (Phase 10): create / update / resend invitation.
  // ADMIN only — `clinician:list` (read) also covers the detail route.
  'clinician:manage',
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
  // Monthly call log (Phase 7). Scoping is the same clinician-assignment
  // existence-check shape as `plan:manage` — enforced in the service, not here. Not
  // granted to PARENT — see docs/rbac.md decision notes.
  'monthly-call:create',
  'monthly-call:read',
  // Backend API completion (Phase 8). Admin-only lifecycle/discovery permissions, plus
  // one new self-scope permission — see docs/rbac.md decision notes.
  'user:manage-status',
  'user:list',
  'admin-summary:read',
  'user:change-password:self',
  // Background job queue (Phase 11). ADMIN only: `job:read` lists/gets jobs (the DEAD rows
  // are the error list); `job:manage` requeues a DEAD job and triggers a run-now pass.
  'job:read',
  'job:manage',
  // Media consent record + manual weekly coaching (Phase 12). Scoping is service-level —
  // see docs/rbac.md §6 (clinician excluded from consent; coaching author redaction).
  'consent:read',
  'consent:manage:self',
  'coaching:manage',
  'coaching:read',
  // Child progress tracking (Phase 13). Write is PARENT-only and enforced in the service
  // (ADMIN spreads every permission but must not write); read is parent-own /
  // clinician-assigned / admin-any, same shape as `media:read`.
  'progress:write:self',
  'progress:read',
  // Monthly call appointments (Phase 14). Scoping is service-level — see docs/rbac.md §6
  // (clinician publishes only own slots; unassigned clinician slot → 404; `appointment:create:self`
  // reaches ADMIN via the spread, so the service restricts booking to the child's PARENT).
  'appointment-slot:manage',
  'appointment-slot:read',
  'appointment:create:self',
  'appointment:read',
  // AI coaching tip (Phase 18). Generate is the child's own PARENT only (ADMIN reaches it through
  // the `...PERMISSIONS` spread, so the service rejects it); read is the `child:read` shape.
  // `ai-run:read` is the ADMIN-only usage view. See docs/rbac.md §6.
  'ai-coaching:generate:self',
  'ai-coaching:read',
  'ai-run:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SELF_PERMISSIONS: Permission[] = [
  'user:read:self',
  'user:deactivate:self',
  'user:change-password:self',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.PARENT]: [
    ...SELF_PERMISSIONS,
    'child:create:self',
    'child:read',
    'media:create:self',
    'media:read',
    'plan:read',
    'consent:read',
    'consent:manage:self',
    'coaching:read',
    'progress:write:self',
    'progress:read',
    'appointment-slot:read',
    'appointment:create:self',
    'appointment:read',
    'ai-coaching:generate:self',
    'ai-coaching:read',
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
    'monthly-call:create',
    'monthly-call:read',
    'coaching:manage',
    'coaching:read',
    'progress:read',
    'appointment-slot:manage',
    'appointment-slot:read',
    'appointment:read',
    'ai-coaching:read',
  ],
  [Role.ADMIN]: [...PERMISSIONS],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
