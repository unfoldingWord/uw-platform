import { describe, expect, it } from 'vitest';
import { boundedJson, MAX_BODY_BYTES } from './body.ts';

function streamed(bytes: number): Request {
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return new Request('https://x.test/', { method: 'POST', body, duplex: 'half' } as RequestInit);
}

describe('the bounded person body reader', () => {
  it('reads a small JSON body', async () => {
    const request = new Request('https://x.test/', { method: 'POST', body: '{"a":1}' });
    expect(await boundedJson(request)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('refuses a 300 KiB body declared by its length', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(300 * 1024) });
    const request = new Request('https://x.test/', { method: 'POST', body });
    expect(await boundedJson(request)).toEqual({ ok: false });
  });

  it('refuses a 300 KiB body streamed without a length', async () => {
    expect(await boundedJson(streamed(300 * 1024))).toEqual({ ok: false });
  });

  it('caps at 256 KiB, the same bound as the MCP surface', () => {
    expect(MAX_BODY_BYTES).toBe(256 * 1024);
  });

  it('answers invalid JSON as unreadable', async () => {
    const request = new Request('https://x.test/', { method: 'POST', body: '{' });
    expect(await boundedJson(request)).toEqual({ ok: false });
  });
});
