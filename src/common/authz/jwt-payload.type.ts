import { Role, UserStatus } from '@prisma/client';

/** Claims carried by the short-lived access token. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  status: UserStatus;
  /** Impersonation only: the id of the ADMIN acting as `sub` (see ImpersonateUserService). */
  imp?: string;
}

/** Shape attached to `request.user` after {@link JwtAuthGuard} runs. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  /** Set when an ADMIN is acting as this user through an impersonation token. */
  impersonatedBy?: string;
}
