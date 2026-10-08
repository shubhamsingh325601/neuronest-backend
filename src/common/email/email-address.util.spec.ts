import { extractAddress, parseSender } from './email-address.util';

describe('email-address.util', () => {
  it('extractAddress reads bracketed and bare addresses', () => {
    expect(extractAddress('NeuroNest <Me@Gmail.com>')).toBe('me@gmail.com');
    expect(extractAddress('me@gmail.com')).toBe('me@gmail.com');
    expect(extractAddress('nope')).toBeNull();
  });

  it('parseSender splits name and address', () => {
    expect(parseSender('NeuroNest <me@gmail.com>')).toEqual({
      name: 'NeuroNest',
      email: 'me@gmail.com',
    });
    expect(parseSender('"Neuro Nest" <me@gmail.com>')).toEqual({
      name: 'Neuro Nest',
      email: 'me@gmail.com',
    });
    expect(parseSender('me@gmail.com')).toEqual({ email: 'me@gmail.com' });
    expect(parseSender('nope')).toBeNull();
  });
});
