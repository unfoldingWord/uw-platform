import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../base64.ts';
import { DATA_KEY_BYTES, type DataKey, type DataKeys, type KeyContext } from '../data-keys.ts';

export type DataKeysSubject = {
  readonly keys: DataKeys;
  loseTheService(): void;
};

const context: KeyContext = {
  purpose: 'credential',
  credential_id: '00000000-0000-4000-8000-0000000157c1',
  version_id: '00000000-0000-4000-8000-0000000157d1',
  jd_area: '20-29',
};

async function generated(keys: DataKeys, under: KeyContext = context): Promise<DataKey> {
  const outcome = await keys.generate(under);
  if (!outcome.ok) throw new Error(`generate was refused: ${outcome.reason}`);
  return outcome.value;
}

function flipped(text: string): string {
  const bytes = fromBase64(text);
  if (bytes === null) throw new Error('the wrapped key is not base64');
  const middle = Math.floor(bytes.length / 2);
  return toBase64(bytes.map((byte, index) => (index === middle ? byte ^ 0x01 : byte)));
}

function generating(open: () => Promise<DataKeysSubject>): void {
  it('generates a 256-bit data key with its wrapped copy and the id of the key that wrapped it', async () => {
    const key = await generated((await open()).keys);
    expect(key.plaintext).toHaveLength(DATA_KEY_BYTES);
    expect(fromBase64(key.wrapped)).not.toBeNull();
    expect(key.keyId.length).toBeGreaterThan(0);
  });

  it('never hands out the same data key twice', async () => {
    const { keys } = await open();
    const [one, two] = [await generated(keys), await generated(keys)];
    expect(toBase64(one.plaintext)).not.toBe(toBase64(two.plaintext));
    expect(one.wrapped).not.toBe(two.wrapped);
  });

  it('keeps the data key out of its wrapped copy', async () => {
    const key = await generated((await open()).keys);
    const wrapped = fromBase64(key.wrapped) ?? new Uint8Array();
    expect(toBase64(wrapped)).not.toContain(toBase64(key.plaintext).slice(0, 40));
  });
}

function unwrapping(open: () => Promise<DataKeysSubject>): void {
  it('unwraps a key to the bytes it generated, under the same context', async () => {
    const { keys } = await open();
    const key = await generated(keys);
    const expected = toBase64(key.plaintext);
    const outcome = await keys.unwrap({ wrapped: key.wrapped, keyId: key.keyId }, { ...context });
    expect(outcome.ok && toBase64(outcome.value)).toBe(expected);
  });

  it.each(Object.keys(context))(
    'refuses to unwrap when the context differs in %s',
    async (name) => {
      const { keys } = await open();
      const key = await generated(keys);
      const other = { ...context, [name]: 'changed' };
      expect(await keys.unwrap({ wrapped: key.wrapped, keyId: key.keyId }, other)).toEqual({
        ok: false,
        reason: 'key_rejected',
      });
    },
  );

  it('refuses to unwrap under a context with a field removed or added', async () => {
    const { keys } = await open();
    const key = await generated(keys);
    const wrapped = { wrapped: key.wrapped, keyId: key.keyId };
    const fewer = Object.fromEntries(Object.entries(context).slice(1));
    const refused = { ok: false, reason: 'key_rejected' };
    expect(await keys.unwrap(wrapped, fewer)).toEqual(refused);
    expect(await keys.unwrap(wrapped, { ...context, extra: 'x' })).toEqual(refused);
  });
}

function refusingOtherKeys(open: () => Promise<DataKeysSubject>): void {
  it('refuses a wrapped key with one bit changed', async () => {
    const { keys } = await open();
    const key = await generated(keys);
    const tampered = { wrapped: flipped(key.wrapped), keyId: key.keyId };
    expect(await keys.unwrap(tampered, context)).toEqual({ ok: false, reason: 'key_rejected' });
  });

  it('refuses a wrapped key that names another key-encryption key', async () => {
    const { keys } = await open();
    const key = await generated(keys);
    const renamed = { wrapped: key.wrapped, keyId: `${key.keyId}-other` };
    const outcome = await keys.unwrap(renamed, context);
    expect(outcome.ok).toBe(false);
    expect(['key_rejected', 'key_service_refused']).toContain(!outcome.ok && outcome.reason);
  });

  it('refuses a key another service wrapped', async () => {
    const key = await generated((await open()).keys);
    const { keys } = await open();
    const outcome = await keys.unwrap({ wrapped: key.wrapped, keyId: key.keyId }, context);
    expect(outcome.ok).toBe(false);
    expect(['key_rejected', 'key_service_refused']).toContain(!outcome.ok && outcome.reason);
  });
}

function failing(open: () => Promise<DataKeysSubject>): void {
  it('answers key_service_unavailable, and never throws, when the service cannot be reached', async () => {
    const subject = await open();
    const key = await generated(subject.keys);
    subject.loseTheService();
    expect(await subject.keys.generate(context)).toEqual({
      ok: false,
      reason: 'key_service_unavailable',
    });
    subject.loseTheService();
    const outcome = await subject.keys.unwrap({ wrapped: key.wrapped, keyId: key.keyId }, context);
    expect(outcome).toEqual({ ok: false, reason: 'key_service_unavailable' });
  });
}

export function describeDataKeysContract(
  adapter: string,
  open: () => Promise<DataKeysSubject>,
): void {
  describe(`#157 data keys contract on ${adapter}`, () => {
    generating(open);
    unwrapping(open);
    refusingOtherKeys(open);
    failing(open);
  });
}
