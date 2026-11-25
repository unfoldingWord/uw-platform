import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '@uw/db/test-database';
import { seedPage } from '@uw/db/test-seed';
import { VIEWER_80, openRig, page, summary, viewer, type Rig } from '../testing/context-rig.ts';

describe.skipIf(!testServer)('PO-3 resolve_context carries the policies in force', () => {
  let rig: Rig | null = null;
  beforeAll(async () => {
    rig = await openRig();
  });
  afterAll(async () => {
    await rig?.drop();
  });

  it('answers the organization policies in force that the caller may read', async () => {
    if (rig === null) throw new Error('the rig is not open');
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
  });
});
