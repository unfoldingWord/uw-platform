import { grantSchema, type Grant, type JdArea, type Role, type Scope } from '@uw/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Grants, Store } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

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
  seedPerson(id: string): Promise<void>;
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
        orgAdmin(1, p1),
        areaEditor(2, p1, new Date('2030-06-01T00:00:00.000Z')),
      ]);
      expect(await subject().grants.resolve(p1, at)).toEqual([
        { grantId: grantId(1), role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt: null },
        {
          grantId: grantId(2),
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

export function describeGrantsContract(adapter: string, open: () => Promise<GrantsSubject>): void {
  const subject = withSubject(open);
  describeGrantsResolve(adapter, subject);
  describeGrantsUnderLock(adapter, subject);
}

export function describeGrantsNotWired(adapter: string, grants: Grants): void {
  describeNotWired('grants', adapter, grants, {
    resolve: true,
    lockAndReread: true,
  } satisfies Record<keyof Grants, true>);
}
