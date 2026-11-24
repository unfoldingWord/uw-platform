const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length === 0 || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  try {
    const bytes = Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
    return toBase64(bytes) === text ? bytes : null;
  } catch {
    return null;
  }
}

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}
