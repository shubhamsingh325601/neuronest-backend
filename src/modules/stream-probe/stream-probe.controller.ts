import { Controller, Get, HttpException, HttpStatus, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth } from '@common/authz/auth.decorator';
import { StreamProbeQueryDto } from './stream-probe.dto';

const MAX_CONCURRENT = 5;

/**
 * TEMPORARY (plan 0019 Batch 0.3, remove right after the staging measurement): an authenticated
 * SSE probe that sends synthetic ticks only (no AI, no database, no user data). It exists to
 * measure, from outside, whether the real host's proxy buffers streamed responses or cuts idle
 * ones. Bounded by `seconds <= 90` and {@link MAX_CONCURRENT} open streams. Excluded from
 * OpenAPI, so it has no `docs.e2e` row.
 */
@ApiExcludeController()
@Controller({ path: 'stream-probe', version: '1' })
export class StreamProbeController {
  private active = 0;

  @Get()
  @Auth('user:read:self')
  probe(@Query() q: StreamProbeQueryDto, @Res() res: Response): void {
    if (this.active >= MAX_CONCURRENT) {
      throw new HttpException(
        { code: 'STREAM_PROBE_BUSY', message: 'Too many open probe streams.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.active++;

    const seconds = q.seconds ?? 10;
    const tickMs = q.tickMs ?? 500;
    const heartbeatSeconds = q.heartbeatSeconds ?? 0;

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    if (q.hints !== 0) {
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
    }
    res.flushHeaders();

    const started = Date.now();
    let n = 0;
    const send = (event: string, data: Record<string, unknown>) =>
      res.write(`id: ${n}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const timers: NodeJS.Timeout[] = [];
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.active--;
      timers.forEach((t) => {
        clearTimeout(t);
        clearInterval(t);
      });
    };
    // 'close' fires on client disconnect and after a normal end.
    res.on('close', release);

    send('start', { serverTime: started, seconds, tickMs, heartbeatSeconds, hints: q.hints !== 0 });
    timers.push(
      setInterval(() => {
        n++;
        send('tick', { n, elapsedMs: Date.now() - started });
      }, tickMs),
    );
    if (heartbeatSeconds > 0) {
      timers.push(setInterval(() => res.write(': hb\n\n'), heartbeatSeconds * 1000));
    }
    timers.push(
      setTimeout(() => {
        send('done', { elapsedMs: Date.now() - started });
        res.end();
        release();
      }, seconds * 1000),
    );
  }
}
