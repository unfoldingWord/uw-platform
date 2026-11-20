import type { DataKeyRefusal } from '@uw/core/credentials';
import { fromBase64, toBase64 } from '../base64.ts';
import {
  DATA_KEY_BYTES,
  canonicalContext,
  keyRefusal,
  type DataKeyOutcome,
  type DataKeys,
  type KeyContext,
  type WrappedKey,
} from '../data-keys.ts';

const NONCE_BYTES = 12;

export type MemoryDataKeys = DataKeys & {
  readonly keyId: string;
  failNext(reason: DataKeyRefusal): void;
};

async function wrap(kek: CryptoKey, key: Uint8Array<ArrayBuffer>, context: KeyContext) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: canonicalContext(context) },
    kek,
    key,
  );
  const blob = new Uint8Array(NONCE_BYTES + sealed.byteLength);
  blob.set(nonce, 0);
  blob.set(new Uint8Array(sealed), NONCE_BYTES);
  return toBase64(blob);
}

async function unwrap(
  kek: CryptoKey,
  wrapped: string,
  context: KeyContext,
): Promise<DataKeyOutcome<Uint8Array<ArrayBuffer>>> {
  const blob = fromBase64(wrapped);
  if (blob === null || blob.length <= NONCE_BYTES) return keyRefusal('key_rejected');
  try {
    const opened = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: blob.slice(0, NONCE_BYTES),
        additionalData: canonicalContext(context),
      },
      kek,
      blob.slice(NONCE_BYTES),
    );
    return { ok: true, value: new Uint8Array(opened) };
  } catch {
    return keyRefusal('key_rejected');
  }
}

async function keyEncryptionKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  if ('privateKey' in key) throw new TypeError('expected one symmetric key');
  return key;
}

export async function memoryDataKeys(keyId = 'memory-key-1'): Promise<MemoryDataKeys> {
  const kek = await keyEncryptionKey();
  let failing: DataKeyRefusal | null = null;
  const failed = (): DataKeyRefusal | null => {
    const reason = failing;
    failing = null;
    return reason;
  };
  return {
    keyId,
    failNext: (reason) => {
      failing = reason;
    },
    generate: async (context) => {
      const reason = failed();
      if (reason !== null) return keyRefusal(reason);
      const plaintext = crypto.getRandomValues(new Uint8Array(DATA_KEY_BYTES));
      return {
        ok: true,
        value: { plaintext, wrapped: await wrap(kek, plaintext, context), keyId },
      };
    },
    unwrap: async (key: WrappedKey, context) => {
      const reason = failed();
      if (reason !== null) return keyRefusal(reason);
      if (key.keyId !== keyId) return keyRefusal('key_rejected');
      return unwrap(kek, key.wrapped, context);
    },
  };
}
