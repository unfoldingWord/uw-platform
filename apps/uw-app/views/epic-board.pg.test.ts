import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { defaultCiChecks } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { EpicFacts, IssueFact } from '@uw/harness';
import { software, type Clock } from '@uw/harness';
import { boardWorld } from '../testing/board-world.ts';
import { accepted, callerOf } from '../testing/commands.ts';
import { answeringEpic, kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { boardPath } from './parts/paths.ts';

const seedClock: Clock = { now: () => new Date('2026-10-15T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-15T09:00:00.000Z') };
const repository = 'unfoldingWord/uw-platform';

function fact(number: number, title: string, blockedBy: readonly number[] = []): IssueFact {
  return {
    issue: { repo: repository, number, githubId: 9100000300 + number },
    title,
    open: true,
    doneWhen: [`${title} ships.`],
    blockedBy,
  };
}

const epic: EpicFacts = {
  epic: { ...fact(40, 'Epic intake'), doneWhen: [] },
  subIssueCount: 3,
  subIssues: [
    fact(41, 'Read the sub-issues'),
    fact(42, 'Enqueue the epic'),
    fact(43, 'Show the epic', [42]),
  ],
};

const notReadyEpic: EpicFacts = {
  epic: { ...fact(50, 'Later epic'), doneWhen: [] },
  subIssueCount: 1,
  subIssues: [{ ...fact(51, 'Not written yet'), doneWhen: [] }],
};

async function epicBoardHtml(): Promise<string> {
  let html = '';
  await withAppDatabase(async (db) => {
    const world = await boardWorld(db, seedClock);
    const kernel = kernelOn(db, seedClock, { githubFacts: answeringEpic(epic) });
    const harnessId = randomUUID();
    accepted(
      await kernel.stages.activate(callerOf(world.ian), {
        harnessId,
        harnessKey: 'epics',
        jdArea: '80-89',
        template: software,
        repository,
        requiredChecks: defaultCiChecks,
      }),
    );
    const caller = callerOf(world.ian);
    accepted(
      await kernel.items.enqueueEpic(caller, { harnessId, epic: { repo: repository, number: 40 } }),
    );
    const later = kernelOn(db, seedClock, { githubFacts: answeringEpic(notReadyEpic) });
    const refused = await later.items.enqueueEpic(caller, {
      harnessId,
      epic: { repo: repository, number: 50 },
    });
    expect(refused).toMatchObject({ status: 'error', reason: 'done_when_missing' });
    html = (await getHtml(db, world.ianEmail, boardPath(harnessId), {}, viewClock)).text;
  });
  return html;
}

describe.skipIf(!testServer)('EI-5 the Board screen draws an epic', () => {
  it('shows the epic under its title with its items in order and the blocker in words and as an edge', async () => {
    const document = new JSDOM(await epicBoardHtml()).window.document;
    const group = document.querySelector('[data-epic="40"]');
    expect(group?.querySelector('h3')?.textContent).toBe('#40 Epic intake');
    const listed = [...(group?.querySelectorAll('ol > li') ?? [])].map(
      (entry) => entry.textContent ?? '',
    );
    expect(listed).toHaveLength(3);
    expect(listed[2]).toContain('waits on #42');
    expect(group?.querySelectorAll('svg [data-edge]')).toHaveLength(1);
    expect(group?.querySelector('svg title')?.textContent).toContain('Epic intake');
    const notReady = [...document.querySelectorAll('section')].find(
      (section) => section.querySelector('h2')?.textContent === 'Not ready',
    );
    expect(notReady?.querySelector('li')?.textContent).toBe(
      '#51 Not written yet. Refused when its epic was enqueued.',
    );
  });

  it('draws the epic at its natural size with its links out of the tab order', async () => {
    const document = new JSDOM(await epicBoardHtml()).window.document;
    const svg = document.querySelector('[data-epic="40"] svg');
    if (svg === null) throw new Error('no epic drawing');
    const [, , width, height] = (svg.getAttribute('viewBox') ?? '').split(' ');
    expect([svg.getAttribute('width'), svg.getAttribute('height')]).toEqual([width, height]);
    expect(svg.getAttribute('class')?.split(' ')).not.toContain('w-full');
    const drawn = [...svg.querySelectorAll('a')].map((link) => link.getAttribute('tabindex'));
    expect(drawn).toEqual(['-1', '-1', '-1']);
  });

  it('renders with no screen problems: tokens only, focus, names, phone width, light and dark', async () => {
    expect(await screenProblems(await epicBoardHtml())).toEqual([]);
  });
});
