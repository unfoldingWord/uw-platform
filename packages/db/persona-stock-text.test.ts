import { readFileSync } from 'node:fs';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pages, pageVersions } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];
type Stored = { body_md: string; version: number; status: string };
type Snapshot = { version: number; body_md: string; edit_source: string };

const correction = readFileSync(
  new URL('./migrations/0070_persona_stock_verdict_text.sql', import.meta.url),
  'utf8',
);

const oldScout =
  'End your scout with a fenced `harness-scout` block naming `premise` (`holds` or `does_not_hold`) and a one-line `reason`.';
const oldReview =
  'End your review with a fenced `harness-verdict` block naming `verdict` (`approve` or `request_changes`).';
const custom = 'Our own rule: never touch the ledger tables.';

const builder = '00000000-0000-4000-8000-0000000000e1';
const reviewer = '00000000-0000-4000-8000-0000000000e2';
const rewritten = '00000000-0000-4000-8000-0000000000e3';
const learning = '00000000-0000-4000-8000-0000000000e4';

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

async function page(db: Db, id: string, type: string, status: string, body: string): Promise<void> {
  await db.execute(sql`INSERT INTO pages (id, type, jd_area, slug, title, frontmatter, body_md, version, status)
    VALUES (${id}, ${type}, '80-89', ${`stock-${id.slice(-2)}`}, 'A page', '{}'::jsonb, ${body}, 1, ${status})`);
}

async function stored(db: Db, id: string): Promise<Stored | undefined> {
  const [row] = await db
    .select({ body_md: pages.bodyMd, version: pages.version, status: pages.status })
    .from(pages)
    .where(eq(pages.id, id));
  return row;
}

async function snapshots(db: Db, id: string): Promise<Snapshot[]> {
  return db
    .select({
      version: pageVersions.version,
      body_md: pageVersions.bodyMd,
      edit_source: pageVersions.editSource,
    })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, id))
    .orderBy(asc(pageVersions.version));
}

function correctsStoredPersonas(db: () => Db): void {
  it('PE-5 corrects the old stock sentences in a persona page and keeps the text around them', async () => {
    await page(db(), builder, 'persona', 'active', `## Scout\n${oldScout}\n\n${custom}`);
    await page(db(), reviewer, 'persona', 'suggested', `${custom}\n\n${oldReview}`);
    await page(db(), rewritten, 'persona', 'active', custom);
    await page(db(), learning, 'learning', 'active', oldReview);
    await db().execute(sql.raw(correction));

    const scout = await stored(db(), builder);
    expect(scout?.body_md).toContain('Open your scout answer with a fenced `harness-scout` block');
    expect(scout?.body_md).toContain('`held` when the item should not be worked as written');
    expect(scout?.body_md).not.toContain('does_not_hold');
    expect(scout?.body_md).toContain(custom);
    expect(scout).toMatchObject({ version: 2, status: 'active' });

    const review = await stored(db(), reviewer);
    expect(review?.body_md).toBe(
      `${custom}\n\nOpen your review with a fenced \`harness-verdict\` block, and nothing before it, naming \`verdict\` (\`approve\` or \`request_changes\`).`,
    );
    expect(review).toMatchObject({ version: 2, status: 'suggested' });
  });

  it('PE-5 records the corrected version as an edit no person made', async () => {
    const scout = await stored(db(), builder);
    const [snapshot, ...rest] = await snapshots(db(), builder);
    expect(rest).toEqual([]);
    expect(snapshot).toMatchObject({ version: 2, body_md: scout?.body_md });
    expect(snapshot?.edit_source).toMatch(/^agent:[a-z]+$/);
  });

  it('PE-5 leaves a rewritten persona and a page of another type alone', async () => {
    expect(await stored(db(), rewritten)).toEqual({
      body_md: custom,
      version: 1,
      status: 'active',
    });
    expect(await stored(db(), learning)).toEqual({
      body_md: oldReview,
      version: 1,
      status: 'active',
    });
    expect(await snapshots(db(), rewritten)).toEqual([]);
  });

  it('PE-5 changes nothing when it runs again', async () => {
    await db().execute(sql.raw(correction));
    expect((await stored(db(), builder))?.version).toBe(2);
    expect((await stored(db(), reviewer))?.version).toBe(2);
  });
}

describe('the stock persona text correction', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => correctsStoredPersonas(openDatabase(target)),
  );
});
