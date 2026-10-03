const code = /^[a-z][a-z0-9_]*$/;

export function reasonText(reason: string): string {
  if (!code.test(reason)) return reason;
  const words = reason.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function encoded(part: string): string {
  let out = '';
  for (const character of part) {
    out += /^[A-Za-z0-9]$/.test(character)
      ? character
      : `_${(character.codePointAt(0) ?? 0).toString(16)}_`;
  }
  return out;
}

export function domId(...keys: readonly string[]): string {
  return keys.map(encoded).join('-');
}
