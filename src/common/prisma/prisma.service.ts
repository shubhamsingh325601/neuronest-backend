import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Truncate every table — test helper only. Guarded against non-test environments. */
  async truncateAll(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('truncateAll() must never run in production');
    }
    const tables = [
      'monthly_call_logs',
      'plan_notes',
      'plans',
      'plan_template_days',
      'plan_templates',
      'media',
      'verification_tokens',
      'refresh_tokens',
      'clinician_applications',
      'clinician_child_assignments',
      'children',
      'users',
    ];
    for (const table of tables) {
      await this.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
    }
  }
}
