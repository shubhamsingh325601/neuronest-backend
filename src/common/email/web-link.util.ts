/** Builds a frontend link carrying a one-time token, e.g. `{APP_WEB_URL}/reset-password?token=…`. */
export function buildWebLink(appWebUrl: string, path: string, token: string): string {
  return `${appWebUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}
