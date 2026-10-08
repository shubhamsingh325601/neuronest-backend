import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AiAccessService } from './ai-access.service';

const user = (role: Role, id = 'u1'): AuthenticatedUser => ({
  id,
  email: `${id}@example.com`,
  role,
  status: UserStatus.ACTIVE,
});
const child = { id: 'c1', parentId: 'parent-1', name: 'Alex' };

function make(enabled = true) {
  const children = { getById: jest.fn().mockResolvedValue(child) };
  const config = { get: () => ({ enabled }) };
  return { service: new AiAccessService(config as never, children as never), children };
}

describe('AiAccessService', () => {
  describe('assertCanGenerate', () => {
    it('returns the child for its own parent when AI is enabled', async () => {
      const { service, children } = make();
      const parent = user(Role.PARENT, 'parent-1');

      await expect(service.assertCanGenerate('c1', parent)).resolves.toBe(child);
      expect(children.getById).toHaveBeenCalledWith('c1', parent);
    });

    it('delegates ownership: an unrelated parent or missing child fails exactly as GetChildService does', async () => {
      const { service, children } = make();
      children.getById.mockRejectedValueOnce(new ForbiddenException());
      await expect(service.assertCanGenerate('c1', user(Role.PARENT, 'other'))).rejects.toThrow(
        ForbiddenException,
      );
      children.getById.mockRejectedValueOnce(new NotFoundException());
      await expect(service.assertCanGenerate('c1', user(Role.PARENT))).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each([Role.ADMIN, Role.CLINICIAN])(
      '%s may read the child but can never trigger spend: 403',
      async (role) => {
        const { service } = make();
        await expect(service.assertCanGenerate('c1', user(role))).rejects.toThrow(
          ForbiddenException,
        );
      },
    );

    it('503 AI_DISABLED when the feature flag is off', async () => {
      const { service } = make(false);
      const err = await service
        .assertCanGenerate('c1', user(Role.PARENT, 'parent-1'))
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
        code: 'AI_DISABLED',
      });
    });

    it('does not mask an authorization failure with AI_DISABLED', async () => {
      const { service } = make(false);
      await expect(service.assertCanGenerate('c1', user(Role.ADMIN))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getChildForRead', () => {
    it('is GetChildService with the real caller, and ignores the flag', async () => {
      const { service, children } = make(false);
      const clinician = user(Role.CLINICIAN);

      await expect(service.getChildForRead('c1', clinician)).resolves.toBe(child);
      expect(children.getById).toHaveBeenCalledWith('c1', clinician);
    });
  });
});
