import { sha256 } from '@common/crypto/token.util';
import { trackerKey } from './app-throttler.guard';

describe('trackerKey', () => {
  it('prefers the authenticated user id', () => {
    expect(trackerKey({ user: { id: 'u1' }, body: { email: 'a@b.example' } })).toBe('user:u1');
  });

  it('keys public routes on the normalised email', () => {
    expect(trackerKey({ body: { email: '  A@B.Example ' } })).toBe('email:a@b.example');
  });

  it('keys token-only routes on a hash, never the raw token', () => {
    const key = trackerKey({ body: { token: 'raw-secret-token' } });
    expect(key).toBe(`token:${sha256('raw-secret-token')}`);
    expect(key).not.toContain('raw-secret-token');
    expect(trackerKey({ body: { refreshToken: 'r' } })).toBe(`token:${sha256('r')}`);
  });

  it('returns null (not limited) when the request identifies nothing', () => {
    expect(trackerKey({})).toBeNull();
    expect(trackerKey({ body: {} })).toBeNull();
    expect(trackerKey({ body: { email: '  ' } })).toBeNull();
    expect(trackerKey({ body: { email: 123 } })).toBeNull();
  });
});
