import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '@uw/db/test-database';
import { seedPage } from '@uw/db/test-seed';
import { VIEWER_80, openRig, page, summary, viewer, type Rig } from '../testing/context-rig.ts';

async function readablePoliciesInForce(rig: Rig): Promise<void> {
  const frontmatter = { enforcement: 'required', effective_from: '2026-01-01' };
  const [shown, hidden, later] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await seedPage(rig.db, page(shown, { type: 'policy', slug: 'policy-shown', frontmatter }));
  const elsewhere = { type: 'policy' as const, jdArea: '30-39', frontmatter };
  await seedPage(rig.db, page(hidden, { ...elsewhere, slug: 'policy-hidden' }));
  const notYet = { ...frontmatter, effective_from: '2999-01-01' };
  await seedPage(
    rig.db,
    page(later, { type: 'policy', slug: 'policy-later', frontmatter: notYet }),
  );
  const reader = await viewer(rig, VIEWER_80);
  const context = await reader('resolve_context', { itemId: rig.packageItems.bare });
  expect(context['policies']).toEqual([
    {
      page: { ...summary(shown, 'policy'), slug: 'policy-shown' },
      level: 'organization',
      enforcement: 'required',
      effectiveFrom: '2026-01-01',
      effectiveUntil: null,
    },
  ]);
}

const decided = (on: string, supersedes: string[] = []) => ({
  applies_to: null,
  decided_on: on,
  supersedes,
});

async function decisionsNewestFirst(rig: Rig): Promise<void> {
  const [older, newer, other] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const seed = (id: string, slug: string, frontmatter: Record<string, unknown>) =>
    seedPage(rig.db, page(id, { type: 'decision', slug, frontmatter }));
  await seed(older, 'decision-older', decided('2026-01-01'));
  await seed(newer, 'decision-newer', decided('2026-06-01', [older]));
  await seed(other, 'decision-other', decided('2026-03-01'));
  const reader = await viewer(rig, VIEWER_80);
  const context = await reader('resolve_context', { itemId: rig.packageItems.bare });
  const decision = (id: string, slug: string, decidedOn: string) => ({
    page: { ...summary(id, 'decision'), slug },
    level: 'organization',
    decidedOn,
  });
  expect(context['decisions']).toEqual([
    decision(newer, 'decision-newer', '2026-06-01'),
    decision(other, 'decision-other', '2026-03-01'),
  ]);
}

describe.skipIf(!testServer)('PO-3 resolve_context carries the policies and decisions', () => {
  let rig: Rig | null = null;
  beforeAll(async () => {
    rig = await openRig();
  });
  afterAll(async () => {
    await rig?.drop();
  });
  const open = (): Rig => {
    if (rig === null) throw new Error('the rig is not open');
    return rig;
  };

  it('answers the organization policies in force that the caller may read', () =>
    readablePoliciesInForce(open()));

  it('answers the decisions that apply, newest first, leaving out one a later decision supersedes', () =>
    decisionsNewestFirst(open()));
});
