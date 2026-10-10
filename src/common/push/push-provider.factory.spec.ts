import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readServiceAccount } from './push-provider.factory';

describe('readServiceAccount', () => {
  const account = { project_id: 'demo', client_email: 'a@demo.iam', private_key: 'key' };

  it('returns null when nothing is configured, so push stays off', () => {
    expect(readServiceAccount('', '')).toBeNull();
    expect(readServiceAccount('  ', '  ')).toBeNull();
  });

  it('reads raw JSON', () => {
    expect(readServiceAccount(JSON.stringify(account), '')).toEqual(account);
  });

  it('reads base64 JSON, for hosts that cannot hold multi-line values', () => {
    const encoded = Buffer.from(JSON.stringify(account)).toString('base64');
    expect(readServiceAccount(encoded, '')).toEqual(account);
  });

  it('reads a file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'push-')), 'account.json');
    writeFileSync(file, JSON.stringify(account));
    expect(readServiceAccount('', file)).toEqual(account);
  });

  it('prefers the JSON value over the path', () => {
    expect(readServiceAccount(JSON.stringify(account), '/does/not/exist.json')).toEqual(account);
  });

  it('throws on a broken value, which the factory turns into "push off"', () => {
    expect(() => readServiceAccount('{not json', '')).toThrow();
  });
});
