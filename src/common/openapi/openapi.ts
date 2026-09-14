import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';
import { ProblemDetailsDto } from '@common/dto/problem-details.dto';

/**
 * Builds the OpenAPI document from the live Nest metadata (there is no committed spec
 * file) and mounts:
 *   - GET /openapi.json  — the raw spec, served from the in-memory object
 *   - GET /docs          — Scalar interactive reference, reading that same spec
 *
 * Both routes sit outside URI versioning. The document is built once at boot from the
 * running code, so it can never drift from a stale checked-in copy; the docs test
 * asserts every expected path + operationId is present.
 */
export function setupOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('NeuroNest API')
    .setDescription('Phase 1 — parent auth, clinician interest capture, admin bootstrap.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
    // The RFC 9457 error shape. Registered so the schema always renders in Scalar
    // even where a route documents its errors only via `@ApiUnauthorizedResponse`.
    extraModels: [ProblemDetailsDto],
  });

  app.use('/openapi.json', (_req: Request, res: Response) => {
    res.json(document);
  });

  app.use(
    '/docs',
    apiReference({
      content: document,
      pageTitle: 'NeuroNest API Reference',
    }),
  );

  return document;
}
