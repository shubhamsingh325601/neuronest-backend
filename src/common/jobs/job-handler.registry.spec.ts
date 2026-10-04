import { JobHandlerRegistry } from './job-handler.registry';

describe('JobHandlerRegistry', () => {
  it('registers and resolves handlers', () => {
    const registry = new JobHandlerRegistry();
    const handler = jest.fn();
    registry.register('x', handler);
    expect(registry.has('x')).toBe(true);
    expect(registry.get('x')).toBe(handler);
    expect(registry.has('y')).toBe(false);
  });

  it('rejects a duplicate registration', () => {
    const registry = new JobHandlerRegistry();
    registry.register('x', jest.fn());
    expect(() => registry.register('x', jest.fn())).toThrow(/already registered/);
  });

  it('keeps recurring jobs', () => {
    const registry = new JobHandlerRegistry();
    registry.registerRecurring({ type: 'x', payload: {}, dedupeKey: () => 'k' });
    expect(registry.recurringJobs()).toHaveLength(1);
  });
});
