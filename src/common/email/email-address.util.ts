/** Domains reserved for documentation/testing (RFC 2606 / 6761); they can never receive or verify mail. */
const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'example.net', 'localhost'];
const PLACEHOLDER_TLDS = ['example', 'test', 'invalid', 'localhost'];

/** Bare address from `Name <addr@host>` or `addr@host`, lower-cased. Null if there is no `@`. */
export function extractAddress(from: string): string | null {
  const bracketed = /<([^<>]+)>\s*$/.exec(from);
  const address = (bracketed ? bracketed[1] : from).trim().toLowerCase();
  return address.includes('@') ? address : null;
}

/** True for an unusable `EMAIL_FROM`: no parseable address, or a reserved/example domain. */
export function isPlaceholderSender(from: string): boolean {
  const address = extractAddress(from);
  if (!address) return true;
  const domain = address.slice(address.lastIndexOf('@') + 1);
  if (!domain) return true;
  const labels = domain.split('.');
  return (
    PLACEHOLDER_TLDS.includes(labels[labels.length - 1]) ||
    PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
  );
}

/** `jane.doe@gmail.com` -> `j***@gmail.com`, so provider failures can be logged without leaking the full address. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}
