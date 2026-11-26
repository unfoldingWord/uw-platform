import type { CredentialCipher, EnvelopeRefusal } from '@uw/core/credentials';
import { fromBase64, toBase64 } from './base64.ts';
import {
  DATA_KEY_BYTES,
  canonicalContext,
  type DataKeyOutcome,
  type DataKeys,
  type KeyContext,
} from './data-keys.ts';

const CIPHER: CredentialCipher = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BITS = 128;
const TAG_BYTES = TAG_BITS / 8;

type CredentialEnvelope = {
  readonly credentialId: string;
  readonly versionId: string;
  readonly jdArea: string;
};
type BotKeyEnvelope = { readonly assistantHarnessId: string; readonly botUserId: number };
export type EnvelopeContext = CredentialEnvelope | BotKeyEnvelope;

export type SealedValue = {
  readonly cipher: CredentialCipher;
  readonly ciphertext: string;
  readonly nonce: string;
  readonly wrappedKey: string;
  readonly keyId: string;
};

type Refused = { readonly ok: false; readonly reason: EnvelopeRefusal };
export type Sealed = { readonly ok: true; readonly sealed: SealedValue } | Refused;
export type Opened = { readonly ok: true; readonly plaintext: Uint8Array<ArrayBuffer> } | Refused;

function refused(reason: EnvelopeRefusal): Refused {
  return { ok: false, reason };
}

function keyContextOf(context: EnvelopeContext): KeyContext {
  if ('assistantHarnessId' in context) {
    return {
      purpose: 'assistant_bot_key',
      harness_id: context.assistantHarnessId,
      bot_user_id: String(context.botUserId),
    };
  }
  return {
    purpose: 'credential',
    credential_id: context.credentialId,
    version_id: context.versionId,
    jd_area: context.jdArea,
  };
}

function authenticatedData(context: EnvelopeContext, keyId: string): Uint8Array<ArrayBuffer> {
  return canonicalContext({ ...keyContextOf(context), cipher: CIPHER, key_id: keyId });
}

async function asked<T>(work: () => Promise<DataKeyOutcome<T>>): Promise<DataKeyOutcome<T>> {
  try {
    return await work();
  } catch {
    return { ok: false, reason: 'key_service_unavailable' };
  }
}

async function importedOnce(
  raw: Uint8Array<ArrayBuffer>,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey | null> {
  try {
    if (raw.length !== DATA_KEY_BYTES) return null;
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
  } finally {
    raw.fill(0);
  }
}

export async function sealValue(
  keys: DataKeys,
  context: EnvelopeContext,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Sealed> {
  const generated = await asked(() => keys.generate(keyContextOf(context)));
  if (!generated.ok) return refused(generated.reason);
  const { wrapped, keyId } = generated.value;
  const key = await importedOnce(generated.value.plaintext, 'encrypt');
  if (key === null) return refused('key_service_unavailable');
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: authenticatedData(context, keyId),
      tagLength: TAG_BITS,
    },
    key,
    plaintext,
  );
  return {
    ok: true,
    sealed: {
      cipher: CIPHER,
      ciphertext: toBase64(new Uint8Array(ciphertext)),
      nonce: toBase64(nonce),
      wrappedKey: wrapped,
      keyId,
    },
  };
}

type Parts = {
  readonly nonce: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
};

function partsOf(sealed: SealedValue): Parts | null {
  if (sealed.cipher !== CIPHER) return null;
  const nonce = fromBase64(sealed.nonce);
  const ciphertext = fromBase64(sealed.ciphertext);
  if (nonce === null || ciphertext === null) return null;
  if (nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) return null;
  return { nonce, ciphertext };
}

export async function openValue(
  keys: DataKeys,
  context: EnvelopeContext,
  sealed: SealedValue,
): Promise<Opened> {
  const parts = partsOf(sealed);
  if (parts === null) return refused('envelope_malformed');
  const wrapped = { wrapped: sealed.wrappedKey, keyId: sealed.keyId };
  const unwrapped = await asked(() => keys.unwrap(wrapped, keyContextOf(context)));
  if (!unwrapped.ok) return refused(unwrapped.reason);
  const key = await importedOnce(unwrapped.value, 'decrypt');
  if (key === null) return refused('key_service_unavailable');
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: parts.nonce,
        additionalData: authenticatedData(context, sealed.keyId),
        tagLength: TAG_BITS,
      },
      key,
      parts.ciphertext,
    );
    return { ok: true, plaintext: new Uint8Array(plaintext) };
  } catch {
    return refused('ciphertext_rejected');
  }
}
