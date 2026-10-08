/** Bare address from `Name <addr@host>` or `addr@host`, lower-cased. Null if there is no `@`. */
export function extractAddress(from: string): string | null {
  const bracketed = /<([^<>]+)>\s*$/.exec(from);
  const address = (bracketed ? bracketed[1] : from).trim().toLowerCase();
  return address.includes('@') ? address : null;
}

/** `jane.doe@gmail.com` -> `j***@gmail.com`, so provider failures can be logged without leaking the full address. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}
