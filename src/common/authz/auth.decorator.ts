import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import { ProblemDetailsDto } from '@common/dto/problem-details.dto';
import type { Permission } from './permissions';

export const IS_PUBLIC_KEY = 'authz:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'authz:requiredPermissions';

/** Opt a route out of {@link JwtAuthGuard} / {@link PermissionsGuard}. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Attach required permissions without implying anything else. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Mark a route as authenticated and (optionally) permission-gated, and document the
 * bearer requirement in OpenAPI in one step.
 */
export function Auth(...permissions: Permission[]) {
  return applyDecorators(
    RequirePermissions(...permissions),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({
      description: 'Missing, invalid, or expired access token.',
      content: {
        'application/problem+json': {
          schema: { $ref: getSchemaPath(ProblemDetailsDto) },
          example: {
            type: 'https://docs.neuronest.dev/problems/invalid-token',
            title: 'Invalid Token',
            status: 401,
            detail: 'Access token is invalid or expired.',
            instance: '/v1/users/me',
            code: 'INVALID_TOKEN',
            requestId: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
            timestamp: '2026-08-30T00:00:00.000Z',
          },
        },
      },
    }),
  );
}
