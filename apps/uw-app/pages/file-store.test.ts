import { describe, expect, it } from 'vitest';
import { memoryBucket } from '../testing/files.ts';
import { bucketFiles, memoryFiles, type FileStore } from './file-store.ts';

const bytes = (words: string): Uint8Array => new TextEncoder().encode(words);
const text = (stored: Uint8Array | undefined): string => new TextDecoder().decode(stored);

const adapters: readonly (readonly [string, () => FileStore])[] = [
  ['the bucket adapter over an R2-shaped bucket', () => bucketFiles(memoryBucket())],
  ['the in-memory adapter', memoryFiles],
];

describe.each(adapters)('#175 the file store contract on %s', (_name, make) => {
  it('returns the bytes and the content type it was given, under the key it was given', async () => {
    const store = make();
    await store.put('pages/a/one', { bytes: bytes('first'), contentType: 'text/plain' });
    await store.put('pages/a/two', { bytes: bytes('second'), contentType: 'image/png' });
    const one = await store.get('pages/a/one');
    const two = await store.get('pages/a/two');
    expect([text(one?.bytes), one?.contentType]).toEqual(['first', 'text/plain']);
    expect([text(two?.bytes), two?.contentType]).toEqual(['second', 'image/png']);
  });

  it('answers null for a key nothing was put under', async () => {
    expect(await make().get('pages/a/missing')).toBeNull();
  });

  it('replaces what is under a key, and forgets a key that is removed', async () => {
    const store = make();
    await store.put('pages/a/one', { bytes: bytes('first'), contentType: 'text/plain' });
    await store.put('pages/a/one', { bytes: bytes('again'), contentType: 'text/csv' });
    expect(text((await store.get('pages/a/one'))?.bytes)).toBe('again');
    await store.remove('pages/a/one');
    expect(await store.get('pages/a/one')).toBeNull();
    await expect(store.remove('pages/a/one')).resolves.toBeUndefined();
  });

  it('keeps binary bytes exactly', async () => {
    const store = make();
    const raw = Uint8Array.from([0, 255, 128, 10, 13, 0]);
    await store.put('pages/a/raw', { bytes: raw, contentType: 'image/png' });
    expect([...((await store.get('pages/a/raw'))?.bytes ?? [])]).toEqual([...raw]);
  });
});
