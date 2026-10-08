import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { AppConfig } from '@common/config/configuration';
import { GetChildService } from '@modules/children/features/get-child/get-child.service';
import type { ChildDto } from '@modules/children/shared/child.dto';

/**
 * The single choke point for "may this caller use AI for this child?" (plan 0018 Q12.4).
 * Ownership is not re-implemented: it is `GetChildService.getById` with the real caller
 * (parent-own, clinician-assigned, admin-any; `404 CHILD_NOT_FOUND`). A future parental
 * AI-processing consent check (plan 0018 O-1) belongs here and nowhere else.
 */
@Injectable()
export class AiAccessService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly children: GetChildService,
  ) {}

  get enabled(): boolean {
    return this.config.get('ai', { infer: true }).enabled;
  }

  /** Read access to what the parent was shown: the `child:read` shape. */
  getChildForRead(childId: string, caller: AuthenticatedUser): Promise<ChildDto> {
    return this.children.getById(childId, caller);
  }

  /**
   * Triggering a generation spends provider quota, so it is the child's own parent only.
   * `ai-coaching:generate:self` reaches ADMIN through the `...PERMISSIONS` spread, hence the role
   * check here (same stance as `progress:write:self`).
   */
  async assertCanGenerate(childId: string, caller: AuthenticatedUser): Promise<ChildDto> {
    const child = await this.children.getById(childId, caller);
    if (caller.role !== Role.PARENT || child.parentId !== caller.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        code: 'AI_DISABLED',
        message: 'AI coaching tips are not enabled.',
      });
    }
    return child;
  }
}
