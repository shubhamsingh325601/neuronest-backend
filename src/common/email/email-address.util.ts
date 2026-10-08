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

/** Splits `Name <addr@host>` into `{ name, email }` (name omitted when absent). Null if there is no address. */
export function parseSender(from: string): { name?: string; email: string } | null {
  const email = extractAddress(from);
  if (!email) return null;
  const name = from
    .replace(/<[^<>]*>\s*$/, '')
    .trim()
    .replace(/^"(.*)"$/, '$1');
  return name && name.toLowerCase() !== email ? { name, email } : { email };
}
