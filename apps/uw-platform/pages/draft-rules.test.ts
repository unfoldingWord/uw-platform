import { describe, expect, it } from 'vitest';
import { applyUpdate, Doc, encodeSnapshot, encodeStateAsUpdate, snapshot } from 'yjs';
import { writableUntil } from './draft-handlers.ts';
import { admittedUntil, AUTHORIZED_MS, savedEverything, stillAdmitted } from './draft-rules.ts';

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function shared(): { readonly hub: Doc; readonly saver: Doc } {
  const saver = new Doc();
  saver.getText('t').insert(0, 'Saved text.');
  const hub = new Doc();
  applyUpdate(hub, encodeStateAsUpdate(saver));
  return { hub, saver };
}

describe('#175 a Save closes the shared draft only when it saved everything in it', () => {
  it('closes when the saved copy matches the draft', () => {
    const { hub, saver } = shared();
    expect(savedEverything(hub, base64(encodeSnapshot(snapshot(saver))))).toBe(true);
  });

  it('keeps the draft when someone typed or deleted after the copy was taken', () => {
    const { hub, saver } = shared();
    const sent = base64(encodeSnapshot(snapshot(saver)));
    hub.getText('t').insert(11, ' And more.');
    expect(savedEverything(hub, sent)).toBe(false);
    const other = shared();
    const before = base64(encodeSnapshot(snapshot(other.saver)));
    other.hub.getText('t').delete(0, 6);
    expect(savedEverything(other.hub, before)).toBe(false);
  });

  it('keeps the draft when the save sent no copy, or one it cannot read', () => {
    const { hub } = shared();
    expect(savedEverything(hub, null)).toBe(false);
    expect(savedEverything(hub, 'not base64 at all!')).toBe(false);
    expect(savedEverything(hub, base64(Uint8Array.from([9, 9, 9])))).toBe(false);
  });
});

describe('#175 a draft socket is admitted for a bounded time', () => {
  const now = 1_000_000;

  it('admits until the sooner of the grant expiry and five minutes', () => {
    expect(admittedUntil(String(now + 60_000), now)).toEqual({ until: now + 60_000 });
    expect(admittedUntil(String(now + 10 * AUTHORIZED_MS), now)).toEqual({
      until: now + AUTHORIZED_MS,
    });
  });

  it('admits nothing without a future expiry', () => {
    expect(admittedUntil(null, now)).toBeNull();
    expect(admittedUntil('soon', now)).toBeNull();
    expect(admittedUntil(String(now), now)).toBeNull();
  });

  it('stops admitting a connection once its time is up', () => {
    expect(stillAdmitted({ until: now + 1 }, now)).toBe(true);
    expect(stillAdmitted({ until: now }, now)).toBe(false);
    expect(stillAdmitted(null, now)).toBe(false);
  });
});

describe('#175 a draft socket lasts no longer than the grant that let the person in', () => {
  const at = new Date('2026-11-20T12:00:00.000Z');
  const grant = (expiresAt: string | null, area = '00-09') =>
    ({
      grantId: crypto.randomUUID(),
      role: 'editor',
      scopeKind: 'jd_area',
      scopeArea: area,
      expiresAt,
    }) as const;

  it('ends at the grant expiry when that is sooner than five minutes', () => {
    expect(writableUntil([grant('2026-11-20T12:01:00.000Z')], '00-09', at)).toBe(
      Date.parse('2026-11-20T12:01:00.000Z'),
    );
    expect(writableUntil([grant(null)], '00-09', at)).toBe(at.getTime() + AUTHORIZED_MS);
  });

  it('ignores grants on other areas and grants that only read', () => {
    const viewer = { ...grant(null), role: 'viewer' } as const;
    expect(writableUntil([grant(null, '20-29'), viewer], '00-09', at)).toBe(at.getTime());
  });
});
