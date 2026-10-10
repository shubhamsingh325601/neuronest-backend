import { buildWebLink } from './web-link.util';

describe('buildWebLink', () => {
  it('joins base, path and an encoded token', () => {
    expect(buildWebLink('https://app.example', '/reset-password', 'abc')).toBe(
      'https://app.example/reset-password?token=abc',
    );
  });

  it('tolerates a trailing slash on the base', () => {
    expect(buildWebLink('https://app.example/', '/complete-account-setup', 't')).toBe(
      'https://app.example/complete-account-setup?token=t',
    );
  });

  it('uses the callbackUrl instead of base + path, keeping its query', () => {
    expect(buildWebLink('https://app.example', '/x', 'a+b', 'https://fe.example/set?lang=hi')).toBe(
      'https://fe.example/set?lang=hi&token=a%2Bb',
    );
  });

  it('url-encodes the token', () => {
    expect(buildWebLink('https://app.example', '/x', 'a+b/c=')).toBe(
      'https://app.example/x?token=a%2Bb%2Fc%3D',
    );
  });
});
