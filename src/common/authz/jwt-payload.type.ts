import { Role, UserStatus } from '@prisma/client';

/** Claims carried by the short-lived access token. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  status: UserStatus;
}

/** Shape attached to `request.user` after {@link JwtAuthGuard} runs. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
}
