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

  it('url-encodes the token', () => {
    expect(buildWebLink('https://app.example', '/x', 'a+b/c=')).toBe(
      'https://app.example/x?token=a%2Bb%2Fc%3D',
    );
  });
});
