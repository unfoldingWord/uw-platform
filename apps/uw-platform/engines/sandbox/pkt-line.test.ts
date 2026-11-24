import { describe, expect, it } from 'vitest';
import { parseRefUpdates } from './pkt-line.ts';

const zero = '0'.repeat(40);
const old = 'a'.repeat(40);
const next = 'b'.repeat(40);
const encoder = new TextEncoder();

function line(text: string): string {
  return (text.length + 4).toString(16).padStart(4, '0') + text;
}

function bytes(...parts: readonly string[]): Uint8Array {
  return encoder.encode(parts.join(''));
}

describe('receive-pack ref updates', () => {
  it('reads ref updates from the receive-pack request up to the first flush', () => {
    const first = line(`${old} ${next} refs/heads/harness/x\0report-status side-band-64k\n`);
    const second = line(`${zero} ${next} refs/heads/other\n`);
    expect(parseRefUpdates(bytes(first, second, '0000', 'PACK\0\0binary'))).toEqual([
      { old, new: next, ref: 'refs/heads/harness/x' },
      { old: zero, new: next, ref: 'refs/heads/other' },
    ]);
  });

  it('answers null for a malformed length, a missing flush, a bad line or no update', () => {
    expect(parseRefUpdates(bytes('zz12', '0000'))).toBeNull();
    expect(parseRefUpdates(bytes('0003', '0000'))).toBeNull();
    expect(parseRefUpdates(bytes(line(`${old} ${next} refs/heads/a\n`)))).toBeNull();
    expect(parseRefUpdates(bytes(line(`${old} refs/heads/a\n`), '0000'))).toBeNull();
    expect(parseRefUpdates(bytes(line(`shallow ${old}\n`), '0000'))).toBeNull();
    expect(parseRefUpdates(bytes('00ff', 'short', '0000'))).toBeNull();
    expect(parseRefUpdates(bytes('0000'))).toEqual([]);
  });
});
