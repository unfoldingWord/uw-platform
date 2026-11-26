const SCHEME_END = '://';
const DIGITS = /^[0-9]+$/;
const WWW = 'www.';

function ipv4(hostname: string): boolean {
  const parts = hostname.split('.');
  return parts.length === 4 && parts.every((part) => DIGITS.test(part));
}

function siblingHost(hostname: string): string | null {
  if (ipv4(hostname) || hostname.startsWith('[') || !hostname.includes('.')) return null;
  if (!hostname.startsWith(WWW)) return `${WWW}${hostname}`;
  const apex = hostname.slice(WWW.length);
  return apex.includes('.') ? apex : null;
}

function splitOrigin(origin: string): { scheme: string; hostname: string; port: string } | null {
  const end = origin.indexOf(SCHEME_END);
  if (end <= 0) return null;
  const authority = origin.slice(end + SCHEME_END.length);
  if (authority === '' || authority.includes('/')) return null;
  const colon = authority.startsWith('[') ? -1 : authority.lastIndexOf(':');
  return {
    scheme: origin.slice(0, end + SCHEME_END.length),
    hostname: colon === -1 ? authority : authority.slice(0, colon),
    port: colon === -1 ? '' : authority.slice(colon),
  };
}

export function siteOrigins(origin: string): readonly string[] {
  const parts = splitOrigin(origin);
  const sibling = parts === null ? null : siblingHost(parts.hostname);
  return parts === null || sibling === null
    ? [origin]
    : [origin, `${parts.scheme}${sibling}${parts.port}`];
}
