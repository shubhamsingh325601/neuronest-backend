import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface JobContext {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  /** 1-based attempt number of this run. */
  attempt: number;
}

export type JobHandler = (job: JobContext) => Promise<void>;

/** A job the sweep enqueues on every pass; `dedupeKey` buckets it so one run exists per bucket. */
export interface RecurringJob {
  type: string;
  payload: Prisma.InputJsonValue;
  dedupeKey: (now: Date) => string;
}

/**
 * Code-side registry of job types. `type` is plain text in the table, so adding a job
 * type needs a handler registration (in the owning module's `onModuleInit`), not a migration.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly recurring: RecurringJob[] = [];

  register(type: string, handler: JobHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Job handler already registered for type "${type}"`);
    }
    this.handlers.set(type, handler);
  }

  registerRecurring(job: RecurringJob): void {
    this.recurring.push(job);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }

  recurringJobs(): readonly RecurringJob[] {
    return this.recurring;
  }
}
