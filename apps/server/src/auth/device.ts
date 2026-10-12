/** Browser and OS from a user agent, e.g. "Chrome on Windows" (spec B13.5). */
export function shortDevice(ua: string | null): string {
  if (!ua) return 'unknown';
  let browser: string | null = null;
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os: string | null = null;
  if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  if (browser !== null && os !== null) return `${browser} on ${os}`;
  return browser ?? os ?? 'unknown';
}
