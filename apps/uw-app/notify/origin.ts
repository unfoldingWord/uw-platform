export function httpsOrigin(value: string | undefined): string | null {
  if (value === undefined || !URL.canParse(value)) return null;
  const url = new URL(value);
  const bare = value === url.origin || value === `${url.origin}/`;
  if (url.protocol !== 'https:' || !bare) return null;
  return url.origin;
}
