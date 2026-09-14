import { Module } from '@nestjs/common';
import { HealthAliasController, HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController, HealthAliasController],
  providers: [HealthService],
})
export class HealthModule {}
