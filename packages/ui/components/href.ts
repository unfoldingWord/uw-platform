const scheme = /^[a-z][a-z0-9+.-]*:/i;

function hasUnsafeCharacter(href: string): boolean {
  for (const character of href) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || character === '\\') return true;
  }
  return false;
}

export function safeHref(href: string): string | undefined {
  if (href === '' || hasUnsafeCharacter(href)) return undefined;
  if (href.startsWith('https://')) return href;
  if (href.startsWith('//') || scheme.test(href)) return undefined;
  return href;
}
