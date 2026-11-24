import { describe, expect, it } from 'vitest';
import { boundedBytes } from './file-handlers.ts';

const CHUNK = 1024;

function streamed(chunks: number): { readonly request: Request; readonly pulled: () => number } {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cancelled || pulled >= chunks) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(new Uint8Array(CHUNK).fill(pulled % 256));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('https://uw.example/api/files/x', { method: 'PUT', body });
  return { request, pulled: () => pulled };
}

describe('#175 an upload is refused as soon as it passes the size limit', () => {
  it('stops reading a body with no declared length once it is too large', async () => {
    const { request, pulled } = streamed(25);
    expect(await boundedBytes(request, 4 * CHUNK)).toBeNull();
    expect(pulled()).toBeLessThanOrEqual(6);
  });

  it('keeps every byte of a body within the limit, in order', async () => {
    const { request } = streamed(3);
    const bytes = await boundedBytes(request, 4 * CHUNK);
    expect(bytes?.byteLength).toBe(3 * CHUNK);
    expect([bytes?.at(0), bytes?.at(CHUNK), bytes?.at(2 * CHUNK)]).toEqual([1, 2, 3]);
  });

  it('refuses a declared length over the limit without reading', async () => {
    const request = new Request('https://uw.example/api/files/x', {
      method: 'PUT',
      body: 'x',
      headers: { 'content-length': String(5 * CHUNK) },
    });
    expect(await boundedBytes(request, 4 * CHUNK)).toBeNull();
  });
});
