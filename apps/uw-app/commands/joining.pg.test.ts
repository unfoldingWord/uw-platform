import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { command, eventsNamed, person } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN = { email: 'ian.lindsley@unfoldingword.org' };
const repository = 'unfoldingWord/tc-admin-app';

async function checkOnlyHarness(db: Database, shadow: boolean): Promise<string> {
  const harnessId = randomUUID();
  const sent = await command(db, IAN, harnessId, 'activate_template', {
    requestId: randomUUID(),
    harnessKey: `tc-admin-app-${harnessId.slice(0, 8)}`,
    jdArea: '80-89',
    template: 'check-only',
    repository: `${repository}-${harnessId.slice(0, 8)}`,
    shadow,
    externalReviewerIdentities: ['uwreview[bot]'],
  });
  expect(sent.body).toMatchObject({ status: 'accepted' });
  return harnessId;
}

describe.skipIf(!testServer)('GL-4 shadow through the command API', () => {
  it('activates in shadow, refuses an editor the lift, lifts for an admin and refuses setting it on', () =>
    withAppDatabase(async (db) => {
      const harnessId = await checkOnlyHarness(db, true);
      const [activated] = await eventsNamed(db, harnessId, 'template_activated');
      expect(activated?.evidence).toMatchObject({ shadow: true });
      const editor = await person(db, 'shadow-editor', 'editor', '80-89');
      const lift = { requestId: randomUUID(), shadow: false };
      expect((await command(db, editor, harnessId, 'set_shadow', lift)).body).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
      });
      const lifted = await command(db, IAN, harnessId, 'set_shadow', {
        ...lift,
        requestId: randomUUID(),
      });
      expect(lifted.body).toMatchObject({ status: 'accepted' });
      expect(await eventsNamed(db, harnessId, 'shadow_lifted')).toHaveLength(1);
      const on = await command(db, IAN, harnessId, 'set_shadow', {
        requestId: randomUUID(),
        shadow: true,
      });
      expect(on.status).toBe(400);
    }));
});

describe.skipIf(!testServer)(
  'GL-2 kickstart refuses a check-only harness, which has no Package page',
  () => {
    it('refuses template_has_no_package and leaves the harness without an item or a Package stage', () =>
      withAppDatabase(async (db) => {
        const harnessId = await checkOnlyHarness(db, false);
        const pageId = randomUUID();
        await seedPage(db, {
          id: pageId,
          type: 'product',
          status: 'active',
          jdArea: '80-89',
          slug: 'a-product',
          title: 'A product',
          bodyMd: 'A product page in the area.',
        });
        const kicked = await command(db, IAN, harnessId, 'kickstart', {
          requestId: randomUUID(),
          pageId,
        });
        expect(kicked.body).toMatchObject({ status: 'error', reason: 'template_has_no_package' });
        expect(await eventsNamed(db, harnessId, 'item_created')).toHaveLength(0);
        const packages = await db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM harness_stages WHERE harness_id = ${harnessId} AND bracket = 'product_package'`,
        );
        expect(packages[0]?.n).toBe(0);
      }));
  },
);

async function activatedWith(db: Database, extra: Record<string, unknown>) {
  const harnessId = randomUUID();
  const sent = await command(db, IAN, harnessId, 'activate_template', {
    requestId: randomUUID(),
    harnessKey: `bots-${harnessId.slice(0, 8)}`,
    jdArea: '80-89',
    template: 'check-only',
    repository: `${repository}-${harnessId.slice(0, 8)}`,
    ...extra,
  });
  const rows = await db.execute<{ bots: string[] }>(
    sql`SELECT to_jsonb(bot_authors) AS bots FROM harnesses WHERE id = ${harnessId}`,
  );
  return { sent, bots: rows[0]?.bots ?? null };
}

describe.skipIf(!testServer)('OB-4 activate_template sets the bot authors', () => {
  it('keeps the listed bot authors, defaults to dependabot and refuses a repeated login', () =>
    withAppDatabase(async (db) => {
      const listed = await activatedWith(db, { botAuthors: ['renovate[bot]'] });
      expect(listed.sent.body).toMatchObject({ status: 'accepted' });
      expect(listed.bots).toEqual(['renovate[bot]']);
      expect((await activatedWith(db, {})).bots).toEqual(['dependabot[bot]']);
      const repeated = await activatedWith(db, { botAuthors: ['a[bot]', 'A[bot]'] });
      expect(repeated.sent.status).toBe(400);
      expect(repeated.bots).toBeNull();
    }));
});
