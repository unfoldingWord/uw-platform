const code = /^[a-z][a-z0-9_]*$/;

export function reasonText(reason: string): string {
  if (!code.test(reason)) return reason;
  const words = reason.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function domId(...parts: readonly string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
