import { Controller, Get, HttpCode, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '@common/authz/auth.decorator';
import { HealthService } from './health.service';

async function respond(healthService: HealthService, res: Response) {
  const report = await healthService.check();
  if (report.db === 'down') {
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
  }
  return report;
}

/** Canonical, versioned route — this is the one documented in the OpenAPI spec. */
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'healthCheck',
    summary: 'Liveness + database probe for uptime monitoring.',
  })
  check(@Res({ passthrough: true }) res: Response) {
    return respond(this.healthService, res);
  }
}

/** Version-neutral alias at `/health` so uptime monitors have a path that never moves. */
@ApiExcludeController()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthAliasController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  check(@Res({ passthrough: true }) res: Response) {
    return respond(this.healthService, res);
  }
}
