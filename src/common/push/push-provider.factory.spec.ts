import { readServiceAccount } from './push-provider.factory';

describe('readServiceAccount', () => {
  it('returns null when nothing is configured, so push stays off', () => {
    expect(readServiceAccount('', '', '')).toBeNull();
    expect(readServiceAccount(' ', ' ', ' ')).toBeNull();
  });

  it('builds the service account from the three values', () => {
    expect(readServiceAccount('demo', 'a@demo.iam', 'key')).toEqual({
      projectId: 'demo',
      clientEmail: 'a@demo.iam',
      privateKey: 'key',
    });
  });

  it('names what is missing when only some values are set', () => {
    expect(() => readServiceAccount('demo', '', '')).toThrow(
      'missing FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    );
  });

  it('repairs a private key whose newlines are written as literal backslash-n', () => {
    expect(readServiceAccount('demo', 'a@demo.iam', 'a\\nb')).toMatchObject({ privateKey: 'a\nb' });
  });
});
