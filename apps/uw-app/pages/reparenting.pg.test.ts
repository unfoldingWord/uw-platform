import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';
import { personOn } from '../testing/kernel.ts';
import { updatePage } from './store.ts';

const EDITOR = {
  id: '00000000-0000-4000-8000-000000002801',
  email: 'reparent-editor@unfoldingword.org',
};
const PARENT = '00000000-0000-4000-8000-000000002811';
const OTHER_PARENT = '00000000-0000-4000-8000-000000002812';
const CHILD = '00000000-0000-4000-8000-000000002813';
const frontmatter = { owner: `human:${EDITOR.id}`, summary: 'A product page.' };

async function seedScene(db: Database): Promise<Principal> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002821',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const page = { type: 'product' as const, status: 'draft' as const, jdArea: '80-89' };
  for (const [id, parentId] of [
    [PARENT, null],
    [OTHER_PARENT, null],
    [CHILD, PARENT],
  ] as const) {
    const named = { id, slug: `page-${id.slice(-4)}`, title: 'A page', bodyMd: 'Body.' };
    await seedPage(db, { ...page, ...named, parentId, frontmatter });
  }
  return personOn(db, EDITOR.id, EDITOR.email, new Date());
}

function save(db: Database, person: Principal, parentId: string) {
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId: CHILD,
    expectedVersion: 1,
    slug: 'page-2813',
    title: 'Edited',
    parentId,
    frontmatter,
    bodyMd: 'Edited.',
    status: 'draft' as const,
  };
  return updatePage(db, person, command, crypto.randomUUID(), new Date());
}

type Connections = { readonly db: Database; readonly saver: Database; readonly holder: Database };

async function withReparentingHeld(
  work: (c: Connections, person: Principal) => Promise<{ readonly pending: Promise<unknown> }>,
) {
  const database = await createMigratedDatabase(testServer ?? '');
  const c = {
    db: createClient(database.connectionString),
    saver: createClient(database.connectionString),
    holder: createClient(database.connectionString),
  };
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  try {
    const person = await seedScene(c.db);
    let held = (): void => undefined;
    const holding = new Promise<void>((resolve) => void (held = resolve));
    const holder = c.holder.transaction(async (tx) => {
      await tx.execute(advisoryLock(advisoryLocks.pageReparenting));
      held();
      await released;
    });
    await holding;
    const { pending } = await work(c, person);
    release();
    await holder;
    await pending;
  } finally {
    release();
    await Promise.all(Object.values(c).map((db) => db.$client.end()));
    await database.drop();
  }
}

async function unchangedParent(c: Connections, person: Principal) {
  expect(await save(c.saver, person, PARENT)).toMatchObject({ ok: true });
  return { pending: Promise.resolve() };
}

async function movedParent(c: Connections, person: Principal) {
  const moving = save(c.saver, person, OTHER_PARENT);
  await awaitBlocked(() => lockWaiters(c.db));
  expect(await lockWaiters(c.db)).toBeGreaterThan(0);
  return { pending: moving.then((saved) => expect(saved).toMatchObject({ ok: true })) };
}

describe.skipIf(!testServer)(
  'FD-9 a save takes pages-reparenting only when the parent changes',
  () => {
    it('saves a page with its stored parent while another transaction holds the lock', () =>
      withReparentingHeld(unchangedParent));

    it('waits on the lock for a save that moves the page to another parent', () =>
      withReparentingHeld(movedParent));
  },
);
