/**
 * Builds a frontend link carrying a one-time token, e.g. `{APP_WEB_URL}/reset-password?token=…`.
 * A `callbackUrl` the client asked for (already validated) replaces base + path.
 */
export function buildWebLink(
  appWebUrl: string,
  path: string,
  token: string,
  callbackUrl?: string,
): string {
  if (callbackUrl) {
    const url = new URL(callbackUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
  return `${appWebUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}
