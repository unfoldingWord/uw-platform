import { describe, expect, it } from 'vitest';
import { codeDigestOf, newPairingCode, pairingCodeIn } from './pairing-code.ts';

describe('PA-6 a pairing code', () => {
  it('is eight unambiguous characters, stored only as its digest', async () => {
    const fixed = () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const made = await newPairingCode(fixed);
    expect(made.code).toBe('ABCDEFGH');
    expect(made.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(made.digest).toBe(await codeDigestOf('ABCDEFGH'));
    const random = await newPairingCode((n) => crypto.getRandomValues(new Uint8Array(n)));
    expect(random.code).toMatch(/^[A-HJKMNP-TV-Z2-9]{8}$/);
  });

  it('is read from a message that is only the code, in any case and spacing', () => {
    expect(pairingCodeIn('  abcdefgh \n')).toBe('ABCDEFGH');
    expect(pairingCodeIn('ABCD EFGH')).toBeNull();
    expect(pairingCodeIn('my code is ABCDEFGH')).toBeNull();
    expect(pairingCodeIn('ABCDEFG1')).toBeNull();
  });
});
