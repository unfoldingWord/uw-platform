import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { contextDecisions } from './decisions.ts';
import { contextPolicies, policyChainFor } from './policies.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000002d01', email: 'scale@unfoldingword.org' };
const AREA = '00-09';
const ON = new Date('2026-12-01T12:00:00.000Z');
const MANY = 501;

type Row = typeof pages.$inferInsert;

function row(id: string, type: Row['type'], change: Partial<Row> = {}): Row {
  return {
    id,
    type,
    jdArea: AREA,
    slug: `scale-${id}`,
    title: `Page ${id.slice(-6)}`,
    parentId: null,
    frontmatter: {},
    bodyMd: '',
    version: 1,
    status: 'active',
    ...change,
  };
}

function idOf(n: number, prefix: string): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function reader(db: Database) {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002d02',
    personId: EDITOR.id,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: AREA,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  return personOn(db, EDITOR.id, EDITOR.email, ON);
}

async function requiredPastTheFirstBatch(db: Database): Promise<void> {
  const actor = await reader(db);
  const expired = {
    enforcement: 'required',
    effective_from: '2020-01-01',
    effective_until: '2021-01-01',
  };
  const old = Array.from({ length: MANY }, (_, n) =>
    row(idOf(n, '10000000'), 'policy', { frontmatter: expired }),
  );
  await db.insert(pages).values(old);
  const current = idOf(0, 'f0000000');
  const binding = { enforcement: 'required', effective_from: '2026-01-01' };
  await db.insert(pages).values(row(current, 'policy', { frontmatter: binding }));
  const chain = await policyChainFor(db, { itemId: crypto.randomUUID(), itemPageId: null });
  const policies = await contextPolicies(db, actor, chain, ON, () => undefined);
  expect(policies.map((policy) => policy.page.id)).toEqual([current]);
}

async function productDeeperThanTwenty(db: Database): Promise<void> {
  const product = idOf(0, '20000000');
  await db.insert(pages).values(row(product, 'product', { frontmatter: {} }));
  let parent = product;
  for (let depth = 1; depth <= 25; depth += 1) {
    const id = idOf(depth, '20000000');
    await db.insert(pages).values(row(id, 'knowledge', { parentId: parent }));
    parent = id;
  }
  const chain = await policyChainFor(db, { itemId: crypto.randomUUID(), itemPageId: parent });
  expect(chain.at(0)).toEqual({ level: 'product', pageId: product });
}

async function newestDecisionPastTheFirstBatch(db: Database): Promise<void> {
  const actor = await reader(db);
  const old = Array.from({ length: MANY }, (_, n) =>
    row(idOf(n, '30000000'), 'decision', { frontmatter: { decided_on: '2025-01-01' } }),
  );
  await db.insert(pages).values(old);
  const newest = idOf(0, 'f3000000');
  await db
    .insert(pages)
    .values(row(newest, 'decision', { frontmatter: { decided_on: '2026-11-01' } }));
  const chain = await policyChainFor(db, { itemId: crypto.randomUUID(), itemPageId: null });
  const decisions = await contextDecisions(db, actor, chain, ON, () => undefined);
  expect(decisions.at(0)?.page.id).toBe(newest);
  expect(decisions).toHaveLength(20);
}

describe.skipIf(!testServer)('PO-3 resolution reads every candidate, however many', () => {
  it('finds a required policy past the first batch of expired ones', () =>
    withAppDatabase(requiredPastTheFirstBatch));

  it('finds the nearest product more than twenty pages up', () =>
    withAppDatabase(productDeeperThanTwenty));

  it('ranks every decision before taking the newest twenty', () =>
    withAppDatabase(newestDecisionPastTheFirstBatch));
});
