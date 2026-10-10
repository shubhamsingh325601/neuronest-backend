import { EventEmitter } from 'node:events';
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { StreamProbeController } from './stream-probe.controller';

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const written: string[] = [];
  res.status = jest.fn();
  res.setHeader = jest.fn();
  res.flushHeaders = jest.fn();
  res.write = jest.fn((s: string) => written.push(s));
  res.end = jest.fn(() => res.emit('close'));
  return { res: res as unknown as Response, written, emitter: res };
}

describe('StreamProbeController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('streams ticks, then done, and frees its slot', () => {
    const c = new StreamProbeController();
    const { res, written } = fakeRes();
    c.probe({ seconds: 2, tickMs: 500, heartbeatSeconds: 1, hints: 1 }, res);
    jest.advanceTimersByTime(2000);
    const text = written.join('');
    expect(text).toContain('event: start');
    expect((text.match(/event: tick/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(text).toContain(': hb');
    expect(text).toContain('event: done');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
  });

  it('omits the anti-buffering headers when hints=0', () => {
    const c = new StreamProbeController();
    const { res } = fakeRes();
    c.probe({ seconds: 1, tickMs: 500, hints: 0 }, res);
    expect(res.setHeader).not.toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    jest.advanceTimersByTime(1000);
  });

  it('refuses a sixth concurrent stream with 429 and frees slots on disconnect', () => {
    const c = new StreamProbeController();
    const open = Array.from({ length: 5 }, () => fakeRes());
    open.forEach((o) => c.probe({ seconds: 60, tickMs: 1000 }, o.res));
    expect(() => c.probe({ seconds: 1 }, fakeRes().res)).toThrow(HttpException);
    open[0].emitter.emit('close');
    const extra = fakeRes();
    expect(() => c.probe({ seconds: 1 }, extra.res)).not.toThrow();
    extra.emitter.emit('close');
    open.slice(1).forEach((o) => o.emitter.emit('close'));
  });
});
