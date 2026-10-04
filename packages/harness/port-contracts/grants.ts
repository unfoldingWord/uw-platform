import { grantSchema, type Grant, type JdArea, type Role, type Scope } from '@uw/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GrantHolder, Grants, Store } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';
import { escapedAfter } from './store.ts';

export type SeedGrantInput = {
  readonly id: string;
  readonly personId: string;
  readonly role: Role;
  readonly scopeKind: Scope;
  readonly scopeArea: JdArea | null;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
};

export type GrantsSubject = {
  readonly grants: Grants;
  readonly store: Store;
  seedPerson(id: string, status?: 'active' | 'pending'): Promise<void>;
  seedGrant(grant: SeedGrantInput): Promise<void>;
  revoke(grantId: string, at: Date): Promise<void>;
  close(): Promise<void>;
};

const at = new Date('2030-01-01T00:00:00.000Z');
const person = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const grantId = (n: number) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function orgAdmin(n: number, personId: string): SeedGrantInput {
  return {
    id: grantId(n),
    personId,
    role: 'admin',
    scopeKind: 'org',
    scopeArea: null,
    grantedAt: new Date('2029-01-01T00:00:00.000Z'),
    expiresAt: null,
  };
}

function areaEditor(n: number, personId: string, expiresAt: Date | null): SeedGrantInput {
  return {
    id: grantId(n),
    personId,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2029-02-01T00:00:00.000Z'),
    expiresAt,
  };
}

async function given(subject: GrantsSubject, personId: string, grants: SeedGrantInput[]) {
  await subject.seedPerson(personId);
  for (const grant of grants) await subject.seedGrant(grant);
}

function ids(grants: readonly Grant[]): string[] {
  return grants.map((grant) => grantSchema.parse(grant).grantId);
}

function withSubject(open: () => Promise<GrantsSubject>): () => GrantsSubject {
  let subject: GrantsSubject | undefined;
  beforeAll(async () => {
    subject = await open();
  });
  afterAll(async () => {
    await subject?.close();
  });
  return () => {
    if (!subject) throw new Error('the grants subject is not open');
    return subject;
  };
}

export function describeGrantsResolve(adapter: string, subject: () => GrantsSubject): void {
  describe(`DX-3 grants port contract on ${adapter}: what resolves`, () => {
    it('returns the live grants in grant order, as contract grants', async () => {
      const p1 = person(1);
      await given(subject(), p1, [
        orgAdmin(2, p1),
        areaEditor(1, p1, new Date('2030-06-01T00:00:00.000Z')),
      ]);
      expect(await subject().grants.resolve(p1, at)).toEqual([
        { grantId: grantId(2), role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt: null },
        {
          grantId: grantId(1),
          role: 'editor',
          scopeKind: 'jd_area',
          scopeArea: '80-89',
          expiresAt: '2030-06-01T00:00:00.000Z',
        },
      ]);
    });

    it('judges expiry at the instant it is given, not by the database clock', async () => {
      const p2 = person(2);
      await given(subject(), p2, [areaEditor(3, p2, new Date('2029-12-31T00:00:00.000Z'))]);
      expect(ids(await subject().grants.resolve(p2, at))).toEqual([]);
      const earlier = new Date('2029-06-01T00:00:00.000Z');
      expect(ids(await subject().grants.resolve(p2, earlier))).toEqual([grantId(3)]);
    });

    it('leaves out a revoked grant', async () => {
      const p3 = person(3);
      await given(subject(), p3, [orgAdmin(4, p3)]);
      await subject().revoke(grantId(4), new Date('2029-03-01T00:00:00.000Z'));
      expect(await subject().grants.resolve(p3, at)).toEqual([]);
    });

    it('returns nothing for a person with no grants', async () => {
      expect(await subject().grants.resolve(person(9), at)).toEqual([]);
    });

    it("never returns another person's grants", async () => {
      const p5 = person(5);
      const p6 = person(6);
      await given(subject(), p5, [orgAdmin(6, p5)]);
      await given(subject(), p6, [orgAdmin(7, p6)]);
      expect(ids(await subject().grants.resolve(p5, at))).toEqual([grantId(6)]);
    });
  });
}

export function describeGrantsUnderLock(adapter: string, subject: () => GrantsSubject): void {
  describe(`DX-3 grants port contract on ${adapter}: under lock`, () => {
    it('rereads under lock inside a transaction, and sees a revoke made before it', async () => {
      const p4 = person(4);
      const reread = () =>
        subject().store.transaction((tx) => subject().grants.lockAndReread(tx, p4, at));
      await given(subject(), p4, [orgAdmin(5, p4)]);
      expect(ids(await reread())).toEqual([grantId(5)]);
      await subject().revoke(grantId(5), at);
      expect(ids(await reread())).toEqual([]);
    });
  });
}

function describeGrantsInTransaction(adapter: string, subject: () => GrantsSubject): void {
  describe(`DX-3 grants port contract on ${adapter}: inside a transaction`, () => {
    it('DX-3 reads grants inside a transaction without a lock', async () => {
      const p7 = person(7);
      const reread = () =>
        subject().store.transaction((tx) => subject().grants.resolveIn(tx, p7, at));
      await given(subject(), p7, [orgAdmin(8, p7)]);
      expect(ids(await reread())).toEqual([grantId(8)]);
      await subject().revoke(grantId(8), at);
      expect(ids(await reread())).toEqual([]);
    });
  });
}

function areaGrant(n: number, personId: string, role: Role, area: JdArea): SeedGrantInput {
  return {
    id: grantId(n),
    personId,
    role,
    scopeKind: 'jd_area',
    scopeArea: area,
    grantedAt: new Date('2029-04-01T00:00:00.000Z'),
    expiresAt: null,
  };
}

async function seedHolders(subject: GrantsSubject): Promise<void> {
  await given(subject, person(21), [
    orgAdmin(21, person(21)),
    areaGrant(22, person(21), 'viewer', '10-19'),
  ]);
  await given(subject, person(22), [areaGrant(23, person(22), 'editor', '30-39')]);
  await given(subject, person(23), [
    {
      ...areaGrant(24, person(23), 'admin', '30-39'),
      expiresAt: new Date('2029-12-01T00:00:00.000Z'),
    },
  ]);
  await given(subject, person(24), [areaGrant(25, person(24), 'admin', '30-39')]);
  await subject.revoke(grantId(25), new Date('2029-05-01T00:00:00.000Z'));
  await given(subject, person(25), [areaGrant(26, person(25), 'admin', '40-49')]);
  await given(subject, person(27), [areaGrant(28, person(27), 'viewer', '40-49')]);
  await subject.seedPerson(person(26), 'pending');
  await subject.seedGrant(areaGrant(27, person(26), 'admin', '30-39'));
}

const holderIds = new Set([21, 22, 23, 24, 25, 26, 27].map(person));

function mineOf(holders: readonly GrantHolder[]): readonly GrantHolder[] {
  return holders.filter((holder) => holderIds.has(holder.personId));
}

function describeGrantsHolders(adapter: string, subject: () => GrantsSubject): void {
  describe(`DX-3 grants port contract on ${adapter}: an area's holders`, () => {
    it('holders lists every active person whose live grants can read the area, with all their live grants', async () => {
      await seedHolders(subject());
      const holders = mineOf(await subject().grants.holders('30-39', at));
      expect(holders.map((holder) => [holder.personId, ids(holder.grants)])).toEqual([
        [person(21), [grantId(21), grantId(22)]],
        [person(22), [grantId(23)]],
        [person(25), [grantId(26)]],
      ]);
      expect(holders[0]?.email).toBe(`${person(21)}@fixture.unfoldingword.org`);
    });

    it(
      'holders refuses inside an open transaction',
      async () => {
        expect(await holdersInsideTransaction(subject())).toBe('CallOutsideOpenTransactionError');
      },
      refusalTimeout,
    );
  });
}

function nameOfRefusal(error: unknown): string {
  return error instanceof Error ? error.name : 'rejected';
}

const refusalTimeout = 2_000;

function resolveInsideTransaction({ grants, store }: GrantsSubject): Promise<string> {
  return store.transaction(() =>
    grants.resolve(person(8), at).then(() => 'resolved', nameOfRefusal),
  );
}

function holdersInsideTransaction({ grants, store }: GrantsSubject): Promise<string> {
  return store.transaction(() => grants.holders('30-39', at).then(() => 'resolved', nameOfRefusal));
}

function describeGrantsOutsideTransaction(adapter: string, subject: () => GrantsSubject): void {
  describe(`DX-3 grants port contract on ${adapter}: inside an open transaction`, () => {
    it(
      'refuses a resolve outside the open transaction: the work must reread through it',
      async () => {
        expect(await resolveInsideTransaction(subject())).toBe('CallOutsideOpenTransactionError');
      },
      refusalTimeout,
    );
  });
}

function describeGrantsAfterTransaction(adapter: string, subject: () => GrantsSubject): void {
  describe(`DX-3 grants port contract on ${adapter}: after a transaction`, () => {
    it('lets a continuation scheduled inside the work resolve after the commit', async () => {
      const { grants, store } = subject();
      expect(await escapedAfter(store, () => grants.resolve(person(8), at), false)).toEqual([
        'resolved',
        'resolved',
      ]);
    });

    it('lets a continuation scheduled inside the work resolve after a rollback', async () => {
      const { grants, store } = subject();
      expect(await escapedAfter(store, () => grants.resolve(person(8), at), true)).toEqual([
        'resolved',
        'resolved',
      ]);
    });
  });
}

export function describeGrantsContract(adapter: string, open: () => Promise<GrantsSubject>): void {
  const subject = withSubject(open);
  describeGrantsResolve(adapter, subject);
  describeGrantsUnderLock(adapter, subject);
  describeGrantsInTransaction(adapter, subject);
  describeGrantsOutsideTransaction(adapter, subject);
  describeGrantsAfterTransaction(adapter, subject);
  describeGrantsHolders(adapter, subject);
}

export function describeGrantsNotWired(adapter: string, grants: Grants): void {
  describeNotWired('grants', adapter, grants, {
    resolve: true,
    resolveIn: true,
    lockAndReread: true,
    holders: true,
  } satisfies Record<keyof Grants, true>);
}
