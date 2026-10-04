import { expect, it } from 'vitest';
import type { Identity } from '@uw/contracts';
import type { Delegation, DelegationFilter, Store } from '../ports.ts';
import { at, hour, seedHarness, uid } from './store-gateway-fixtures.ts';

type DelegationsSubject = () => { readonly store: Store };

const bootstrapPerson = '00000000-0000-4000-8000-000000000001';

function delegationOf(base: number, n: number, overrides: Partial<Delegation> = {}): Delegation {
  return {
    id: uid(base + 0x10 + n),
    personId: bootstrapPerson,
    persona: 'agent:one' as Identity,
    harnessId: uid(base),
    capability: 'iterate',
    grantedAt: at,
    expiresAt: new Date(at.getTime() + hour),
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
    ...overrides,
  };
}

const unfiltered: DelegationFilter = { personId: null, persona: null, harnessId: null };

function describeLive(subject: DelegationsSubject): void {
  it('DX-3 KN-16 inserts a delegation and lists the live ones by filter, expiry judged at the instant', async () => {
    const early = delegationOf(0x1100, 1, {
      persona: 'agent:two' as Identity,
      grantedAt: new Date(at.getTime() - hour),
      expiresAt: new Date(at.getTime() + 3 * hour),
    });
    const late = delegationOf(0x1100, 2);
    const result = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x1100, 'gateway-delegations-live');
      await tx.delegations.write.insert(late, uid(0x1180));
      await tx.delegations.write.insert(early, uid(0x1181));
      const ids = async (filter: DelegationFilter, when: Date) =>
        (await tx.delegations.read.live(filter, when)).map((row) => row.id);
      return {
        byId: await tx.delegations.read.byId(late.id),
        absent: await tx.delegations.read.byId(uid(0x11fe)),
        all: await ids({ ...unfiltered, harnessId: uid(0x1100) }, at),
        byPerson: await ids(
          { ...unfiltered, personId: bootstrapPerson, harnessId: uid(0x1100) },
          at,
        ),
        byPersona: await ids({ ...unfiltered, persona: 'agent:two', harnessId: uid(0x1100) }, at),
        otherHarness: await ids({ ...unfiltered, harnessId: uid(0x11ff) }, at),
        afterFirstExpiry: await ids(
          { ...unfiltered, harnessId: uid(0x1100) },
          new Date(at.getTime() + 2 * hour),
        ),
        atExpiry: await ids({ ...unfiltered, harnessId: uid(0x1100) }, late.expiresAt),
      };
    });
    expect(result).toEqual({
      byId: late,
      absent: null,
      all: [early.id, late.id],
      byPerson: [early.id, late.id],
      byPersona: [early.id],
      otherHarness: [],
      afterFirstExpiry: [early.id],
      atExpiry: [early.id],
    });
  });
}

function describeConditionalWrites(subject: DelegationsSubject): void {
  it('DX-3 KN-16 revokes and lapses conditionally: true once, then false, and neither is live', async () => {
    const revoked = delegationOf(0x1200, 1);
    const lapsed = delegationOf(0x1200, 2);
    const later = new Date(at.getTime() + 60_000);
    const result = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x1200, 'gateway-delegations-writes');
      await tx.delegations.write.insert(revoked, uid(0x1280));
      await tx.delegations.write.insert(lapsed, uid(0x1281));
      return {
        revoke: [
          await tx.delegations.write.revoke(revoked.id, later),
          await tx.delegations.write.revoke(revoked.id, later),
        ],
        lapse: [
          await tx.delegations.write.markLapsed(lapsed.id, later),
          await tx.delegations.write.markLapsed(lapsed.id, later),
        ],
        missing: await tx.delegations.write.revoke(uid(0x12fe), later),
        live: await tx.delegations.read.live({ ...unfiltered, harnessId: uid(0x1200) }, at),
        revoked: await tx.delegations.read.byId(revoked.id),
        lapsed: await tx.delegations.read.byId(lapsed.id),
      };
    });
    expect(result).toEqual({
      revoke: [true, false],
      lapse: [true, false],
      missing: false,
      live: [],
      revoked: { ...revoked, revokedAt: later },
      lapsed: { ...lapsed, lapsedAt: later },
    });
  });
}

function describeExpired(subject: DelegationsSubject): void {
  it('DX-3 KN-16 lists the expired delegations not yet revoked or lapsed, oldest expiry first', async () => {
    const first = delegationOf(0x5c00, 1, { expiresAt: new Date(at.getTime() + hour) });
    const second = delegationOf(0x5c00, 2, { expiresAt: new Date(at.getTime() + 2 * hour) });
    const revoked = delegationOf(0x5c00, 3, { revokedAt: at });
    const lapsed = delegationOf(0x5c00, 4, { lapsedAt: at });
    const running = delegationOf(0x5c00, 5, { expiresAt: new Date(at.getTime() + 9 * hour) });
    const mine = new Set([first, second, revoked, lapsed, running].map((row) => row.id));
    const later = new Date(at.getTime() + 3 * hour);
    const result = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x5c00, 'gateway-delegations-expired');
      for (const [n, row] of [first, second, revoked, lapsed, running].entries()) {
        await tx.delegations.write.insert(row, uid(0x5c80 + n));
      }
      const ids = async (limit: number) =>
        (await tx.delegations.read.expiredUnlapsed(later, limit))
          .map((row) => row.id)
          .filter((id) => mine.has(id));
      return {
        all: await ids(500),
        atExpiry: (await tx.delegations.read.expiredUnlapsed(first.expiresAt, 500)).some(
          (row) => row.id === first.id,
        ),
      };
    });
    expect(result).toEqual({ all: [first.id, second.id], atExpiry: true });
  });
}

function describeBoundedLive(subject: DelegationsSubject): void {
  it('counts the live delegations by filter in SQL and lists only the first ones up to the limit', async () => {
    const rows = [1, 2, 3].map((n) =>
      delegationOf(0x5d00, n, { grantedAt: new Date(at.getTime() + n * 60_000) }),
    );
    const revoked = delegationOf(0x5d00, 4, { revokedAt: at });
    const other = delegationOf(0x5d00, 5, { persona: 'agent:two' as Identity });
    const filter = { ...unfiltered, persona: 'agent:one', harnessId: uid(0x5d00) };
    const later = new Date(at.getTime() + 5 * 60_000);
    const result = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x5d00, 'gateway-delegations-bounded');
      for (const [n, row] of [...rows, revoked, other].entries()) {
        await tx.delegations.write.insert(row, uid(0x5d80 + n));
      }
      return {
        count: await tx.delegations.read.countLive(filter, later),
        first: (await tx.delegations.read.firstLive(filter, later, 2)).map((row) => row.id),
        all: (await tx.delegations.read.firstLive(filter, later, 50)).map((row) => row.id),
        none: await tx.delegations.read.countLive({ ...filter, harnessId: uid(0x5dff) }, later),
      };
    });
    expect(result).toEqual({
      count: 3,
      first: [rows[0]?.id, rows[1]?.id],
      all: rows.map((row) => row.id),
      none: 0,
    });
    await Promise.all(
      [0, 5001, 1.5].map((limit) =>
        expect(
          subject().store.transaction((tx) => tx.delegations.read.firstLive(filter, later, limit)),
        ).rejects.toBeInstanceOf(RangeError),
      ),
    );
  });
}

export function describeDelegations(subject: DelegationsSubject): void {
  describeLive(subject);
  describeBoundedLive(subject);
  describeConditionalWrites(subject);
  describeExpired(subject);
}
