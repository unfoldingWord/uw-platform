import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { emptyBatch } from '../github/facts/records.ts';
import { upsertFacts } from '../github/facts/upsert.ts';
import { openedPull, repo } from '../github/testing/facts-fixtures.ts';
import { clock, parkAtShip, people } from '../github/testing/ship-rig.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { boardPath } from './parts/paths.ts';

const IAN = 'ian.lindsley@unfoldingword.org';

async function parkedByBot(db: Database): Promise<string> {
  const { ian } = await people(db);
  const item = await parkAtShip(db, kernelOn(db, clock), ian);
  const pull = { ...openedPull, authorLogin: 'Dependabot[bot]' };
  await upsertFacts(db, { ...emptyBatch, repos: [repo], pullRequests: [pull] }, clock.now());
  return item.harnessId;
}

function itemsFact(html: string, lane: string): string | undefined {
  const { document } = new JSDOM(html).window;
  const section = [...document.querySelectorAll('main section')].find(
    (entry) => entry.querySelector('h2')?.textContent === lane,
  );
  const term = [...(section?.querySelectorAll('dt') ?? [])].find(
    (entry) => entry.textContent === 'Items',
  );
  return term?.nextElementSibling?.textContent ?? undefined;
}

describe.skipIf(!testServer)('OB-4 the Board and Home say what their counts leave out', () => {
  it('OB-4 the Board counts the bot item out of its column and names the bot', () =>
    withAppDatabase(async (db) => {
      const harnessId = await parkedByBot(db);
      const page = await getHtml(db, IAN, boardPath(harnessId), {}, clock);
      expect(itemsFact(page.text, 'Merge, tag, deploy')).toBe(
        '0, not counting 1 by dependabot[bot]',
      );
      expect(await screenProblems(page.text)).toEqual([]);
    }));

  it('OB-4 Home counts the bot gate out of what waits on you and says so', () =>
    withAppDatabase(async (db) => {
      await parkedByBot(db);
      const page = await getHtml(db, IAN, '/', {}, clock);
      const { document } = new JSDOM(page.text).window;
      expect(document.querySelector('main h1 + p')?.textContent).toBe(
        '0 things are waiting on you, not counting 1 on pull requests by bot accounts',
      );
      expect(await screenProblems(page.text)).toEqual([]);
    }));
});
