import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '@app/app.module';
import {
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '@common/authz/auth.decorator';
import { EmailService } from '@common/email/email.service';
import { FakeEmailService } from './helpers/fake-email.service';

/**
 * Reflection-based coverage guard for the authorization layer.
 *
 * Walks every controller Nest actually registered (not a hand-maintained list) and
 * fails if a route handler declares neither `@Public()` nor a non-empty
 * `@RequirePermissions()` / `@Auth()`. Shipping a route "authenticated but ungated"
 * by omission should be impossible — it has to be a visible, deliberate choice.
 */
describe('RBAC route coverage (e2e)', () => {
  let moduleRef: TestingModule;
  let discovery: DiscoveryService;
  let reflector: Reflector;
  const scanner = new MetadataScanner();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(EmailService)
      .useValue(new FakeEmailService())
      .compile();

    discovery = moduleRef.get(DiscoveryService);
    reflector = moduleRef.get(Reflector);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  interface RouteHandler {
    name: string;
    handler: (...args: unknown[]) => unknown;
    classRef: new (...args: unknown[]) => unknown;
  }

  const routeHandlers = (): RouteHandler[] => {
    const rows: RouteHandler[] = [];
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      const classRef = wrapper.metatype as RouteHandler['classRef'] | undefined;
      if (!instance || !classRef) continue;

      const prototype = Object.getPrototypeOf(instance) as object;
      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, RouteHandler['handler']>)[
          methodName
        ];
        // A route handler carries @Get/@Post/... metadata; plain helpers do not.
        const isRoute =
          Reflect.hasMetadata(PATH_METADATA, handler) &&
          Reflect.hasMetadata(METHOD_METADATA, handler);
        if (!isRoute) continue;
        rows.push({ name: `${classRef.name}.${methodName}`, handler, classRef });
      }
    }
    return rows;
  };

  const isPublic = ({ handler, classRef }: RouteHandler): boolean =>
    reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, classRef]) ===
    true;

  const requiredPermissions = ({ handler, classRef }: RouteHandler): string[] =>
    reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      handler,
      classRef,
    ]) ?? [];

  it('discovers the registered controller routes, including the health alias', () => {
    const names = routeHandlers().map((r) => r.name);
    expect(names.length).toBeGreaterThan(0);
    // The version-neutral alias is @ApiExcludeController — invisible to the OpenAPI
    // doc test, so it is the one route easiest to leave ungated unnoticed.
    expect(names).toContain('HealthAliasController.check');
  });

  it('every route declares @Public() or a non-empty permission requirement', () => {
    const ungated = routeHandlers()
      .filter((r) => !isPublic(r) && requiredPermissions(r).length === 0)
      .map((r) => r.name);

    expect(ungated).toEqual([]);
  });

  it('no route is both @Public() and permission-gated', () => {
    const conflicting = routeHandlers()
      .filter((r) => isPublic(r) && requiredPermissions(r).length > 0)
      .map((r) => r.name);

    expect(conflicting).toEqual([]);
  });
});
