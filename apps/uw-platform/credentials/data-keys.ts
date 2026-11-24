import type { DataKeyRefusal } from '@uw/core/credentials';
import { utf8 } from './base64.ts';

export const DATA_KEY_BYTES = 32;

export type KeyContext = Readonly<Record<string, string>>;

export type WrappedKey = { readonly wrapped: string; readonly keyId: string };

export type DataKey = WrappedKey & { readonly plaintext: Uint8Array<ArrayBuffer> };

export type DataKeyOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: DataKeyRefusal };

export type DataKeys = {
  generate(context: KeyContext): Promise<DataKeyOutcome<DataKey>>;
  unwrap(key: WrappedKey, context: KeyContext): Promise<DataKeyOutcome<Uint8Array<ArrayBuffer>>>;
};

export function keyRefusal(reason: DataKeyRefusal): {
  readonly ok: false;
  readonly reason: DataKeyRefusal;
} {
  return { ok: false, reason };
}

export function canonicalContext(context: KeyContext): Uint8Array<ArrayBuffer> {
  const entries = Object.entries(context).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return utf8(JSON.stringify(entries));
}
