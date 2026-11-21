import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64, utf8 as bytes } from './base64.ts';
import type { DataKeys } from './data-keys.ts';
import { openValue, sealValue, type EnvelopeContext, type SealedValue } from './envelope.ts';
import { memoryDataKeys } from './testing/memory-data-keys.ts';

const context: EnvelopeContext = {
  credentialId: '00000000-0000-4000-8000-0000000157c1',
  versionId: '00000000-0000-4000-8000-0000000157d1',
  jdArea: '20-29',
};
const secret = 'partner-api-key: 7f3c9d1e-not-a-real-key';

function text(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

async function sealed(keys: DataKeys, under: EnvelopeContext = context): Promise<SealedValue> {
  const outcome = await sealValue(keys, under, bytes(secret));
  if (!outcome.ok) throw new Error(`sealing was refused: ${outcome.reason}`);
  return outcome.sealed;
}

function flipped(encoded: string, at = 0): string {
  const raw = fromBase64(encoded);
  if (raw === null) throw new Error('not base64');
  raw[at] = (raw.at(at) ?? 0) ^ 0x80;
  return toBase64(raw);
}

function wiped(key: Uint8Array): boolean {
  return key.every((byte) => byte === 0);
}

function recording(inner: DataKeys): { keys: DataKeys; dataKeys: string[] } {
  const dataKeys: string[] = [];
  const keys: DataKeys = {
    generate: async (under) => {
      const outcome = await inner.generate(under);
      if (outcome.ok) dataKeys.push(toBase64(outcome.value.plaintext));
      return outcome;
    },
    unwrap: (key, under) => inner.unwrap(key, under),
  };
  return { keys, dataKeys };
}

function contextBlind(inner: DataKeys): DataKeys {
  let wrappedUnder = {};
  return {
    generate: (under) => {
      wrappedUnder = under;
      return inner.generate(under);
    },
    unwrap: (key) => inner.unwrap(key, wrappedUnder),
  };
}

describe('#157 a value is sealed with AES-256-GCM under its own data key', () => {
  it('opens to the value that was sealed', async () => {
    const keys = await memoryDataKeys();
    const opened = await openValue(keys, context, await sealed(keys));
    expect(opened.ok && text(opened.plaintext)).toBe(secret);
  });

  it('stores a 96-bit nonce, a ciphertext with a 128-bit tag, the wrapped key and the key id', async () => {
    const keys = await memoryDataKeys('kek-7');
    const value = await sealed(keys);
    expect(value.cipher).toBe('aes-256-gcm');
    expect(fromBase64(value.nonce)).toHaveLength(12);
    expect(fromBase64(value.ciphertext)).toHaveLength(bytes(secret).length + 16);
    expect(value.keyId).toBe('kek-7');
  });

  it('uses a fresh data key and a fresh nonce for every seal, so no key meets two values', async () => {
    const { keys, dataKeys } = recording(await memoryDataKeys());
    const [one, two] = [await sealed(keys), await sealed(keys)];
    expect(new Set(dataKeys).size).toBe(2);
    expect(one.nonce).not.toBe(two.nonce);
    expect(one.wrappedKey).not.toBe(two.wrappedKey);
    expect(one.ciphertext).not.toBe(two.ciphertext);
  });

  it('holds neither the value nor the data key in what it stores', async () => {
    const { keys, dataKeys } = recording(await memoryDataKeys());
    const stored = JSON.stringify(await sealed(keys));
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain(toBase64(bytes(secret)));
    expect(stored).not.toContain(dataKeys[0]);
  });

  it('wipes the data key bytes the key service handed over', async () => {
    const inner = await memoryDataKeys();
    const handed: Uint8Array[] = [];
    const keys: DataKeys = {
      generate: async (under) => {
        const outcome = await inner.generate(under);
        if (outcome.ok) handed.push(outcome.value.plaintext);
        return outcome;
      },
      unwrap: async (key, under) => {
        const outcome = await inner.unwrap(key, under);
        if (outcome.ok) handed.push(outcome.value);
        return outcome;
      },
    };
    await openValue(keys, context, await sealed(keys));
    expect(handed).toHaveLength(2);
    expect(handed.every(wiped)).toBe(true);
  });
});

describe('#157 a sealed value that was tampered with fails closed, with a closed-set reason', () => {
  it.each([
    ['the ciphertext', 'ciphertext', 'ciphertext_rejected'],
    ['the authentication tag', 'tag', 'ciphertext_rejected'],
    ['the nonce', 'nonce', 'ciphertext_rejected'],
    ['the wrapped key', 'wrappedKey', 'key_rejected'],
  ] as const)('refuses when %s has one bit changed', async (_name, field, reason) => {
    const keys = await memoryDataKeys();
    const value = await sealed(keys);
    const last = (fromBase64(value.ciphertext)?.length ?? 1) - 1;
    const tampered =
      field === 'tag'
        ? { ...value, ciphertext: flipped(value.ciphertext, last) }
        : { ...value, [field]: flipped(value[field], 5) };
    expect(await openValue(keys, context, tampered)).toEqual({ ok: false, reason });
  });

  it.each([
    ['another credential', { credentialId: '00000000-0000-4000-8000-0000000157c2' }],
    ['another version', { versionId: '00000000-0000-4000-8000-0000000157d2' }],
    ['another area', { jdArea: '80-89' }],
  ])('refuses a value moved to %s: the key service will not unwrap it', async (_name, change) => {
    const keys = await memoryDataKeys();
    const value = await sealed(keys);
    expect(await openValue(keys, { ...context, ...change }, value)).toEqual({
      ok: false,
      reason: 'key_rejected',
    });
  });

  it.each([
    ['another credential', { credentialId: '00000000-0000-4000-8000-0000000157c2' }],
    ['another version', { versionId: '00000000-0000-4000-8000-0000000157d2' }],
    ['another area', { jdArea: '80-89' }],
  ])(
    'refuses a value moved to %s even if the key service ignored the context: the tag binds it',
    async (_name, change) => {
      const keys = contextBlind(await memoryDataKeys());
      const value = await sealed(keys);
      expect((await openValue(keys, context, value)).ok).toBe(true);
      expect(await openValue(keys, { ...context, ...change }, value)).toEqual({
        ok: false,
        reason: 'ciphertext_rejected',
      });
    },
  );
});

describe('#157 a sealed value with a part swapped or rewritten fails closed', () => {
  it('refuses a ciphertext swapped in from another version of the same credential', async () => {
    const keys = await memoryDataKeys();
    const other = await sealed(keys, { ...context, versionId: 'another-version' });
    const value = await sealed(keys);
    const swapped = { ...value, ciphertext: other.ciphertext, nonce: other.nonce };
    expect(await openValue(keys, context, swapped)).toEqual({
      ok: false,
      reason: 'ciphertext_rejected',
    });
  });

  it('refuses a key id that was rewritten', async () => {
    const keys = await memoryDataKeys();
    const value = { ...(await sealed(keys)), keyId: 'another-key' };
    expect(await openValue(keys, context, value)).toEqual({ ok: false, reason: 'key_rejected' });
  });

  it.each([
    ['an unknown cipher', { cipher: 'aes-256-cbc' }],
    ['a nonce of the wrong length', { nonce: 'AAAA' }],
    ['a nonce that is not base64', { nonce: '!!!!!!!!!!!!!!!!' }],
    ['a ciphertext shorter than its tag', { ciphertext: 'AAAA' }],
    ['a ciphertext that is not base64', { ciphertext: 'not base64' }],
  ])('refuses %s as envelope_malformed before asking the key service', async (_name, change) => {
    const inner = await memoryDataKeys();
    let asked = 0;
    const keys: DataKeys = {
      generate: (under) => inner.generate(under),
      unwrap: (key, under) => {
        asked += 1;
        return inner.unwrap(key, under);
      },
    };
    const value = { ...(await sealed(keys)), ...change } as SealedValue;
    expect(await openValue(keys, context, value)).toEqual({
      ok: false,
      reason: 'envelope_malformed',
    });
    expect(asked).toBe(0);
  });
});

describe('#157 a key service failure is a closed-set reason, never exception text', () => {
  it.each(['key_service_unavailable', 'key_service_refused'] as const)(
    'passes %s through from sealing and from opening',
    async (reason) => {
      const keys = await memoryDataKeys();
      const value = await sealed(keys);
      keys.failNext(reason);
      expect(await sealValue(keys, context, bytes(secret))).toEqual({ ok: false, reason });
      keys.failNext(reason);
      expect(await openValue(keys, context, value)).toEqual({ ok: false, reason });
    },
  );

  it('answers key_service_unavailable when the key service throws', async () => {
    const working = await memoryDataKeys();
    const value = await sealed(working);
    const broken: DataKeys = {
      generate: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:443')),
      unwrap: () => Promise.reject(new Error('socket hang up')),
    };
    const refused = { ok: false, reason: 'key_service_unavailable' };
    expect(await sealValue(broken, context, bytes(secret))).toEqual(refused);
    expect(await openValue(broken, context, value)).toEqual(refused);
  });

  it('answers key_service_unavailable when a data key is not 256 bits', async () => {
    const inner = await memoryDataKeys();
    const short: DataKeys = {
      generate: async (under) => {
        const outcome = await inner.generate(under);
        if (!outcome.ok) return outcome;
        return { ok: true, value: { ...outcome.value, plaintext: new Uint8Array(16) } };
      },
      unwrap: (key, under) => inner.unwrap(key, under),
    };
    expect(await sealValue(short, context, bytes(secret))).toEqual({
      ok: false,
      reason: 'key_service_unavailable',
    });
  });
});
