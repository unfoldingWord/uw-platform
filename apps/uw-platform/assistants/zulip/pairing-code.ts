import { sha256Hex } from './digest.ts';

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const LENGTH = 8;
const CODE = /^[A-HJKMNP-TV-Z2-9]{8}$/;

export type PairingCode = { readonly code: string; readonly digest: string };

export function codeDigestOf(code: string): Promise<string> {
  return sha256Hex(code);
}

export async function newPairingCode(random: (count: number) => Uint8Array): Promise<PairingCode> {
  const bytes = random(LENGTH);
  const code = [...bytes.slice(0, LENGTH)]
    .map((byte) => ALPHABET.charAt(byte % ALPHABET.length))
    .join('');
  return { code, digest: await codeDigestOf(code) };
}

export function pairingCodeIn(content: string): string | null {
  const candidate = content.trim().toUpperCase();
  return CODE.test(candidate) ? candidate : null;
}
