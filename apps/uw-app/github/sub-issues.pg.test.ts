import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ghIssues } from '@uw/db/schema';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import restIssues from './fixtures/rest-issues.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import {
  firstRun,
  issuesOf,
  nextRun,
  platform,
  programmed,
  sweepOnce,
} from './testing/sweep-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

const [labelled] = restIssues;
const epicId = 9100000340;
const subIssuesPath = `/repos/${platform}/issues/40/sub_issues`;

function issue(number: number, extra: Record<string, unknown> = {}) {
  return {
    ...labelled,
    id: 9100000300 + number,
    number,
    title: `Issue ${number}`,
    labels: [],
    body: `## Done when\n- Issue ${number} ships.`,
    repository_url: `https://api.github.com/repos/${platform}`,
    ...extra,
  };
}

function withEpic(children: readonly unknown[]) {
  const github = programmed();
  const epic = issue(40, { sub_issues_summary: { total: children.length, completed: 0 } });
  github.on('GET', issuesOf(platform), { status: 200, body: [...restIssues, epic] });
  github.on('GET', subIssuesPath, { status: 200, body: children });
  return github;
}

function recordedIn(lines: readonly Record<string, unknown>[]): boolean {
  return lines.some((line) => line['outcome'] === 'sub_issues_recorded');
}

async function parents(db: Database) {
  const rows = await db
    .select({
      number: ghIssues.number,
      parent: ghIssues.parentIssueId,
      place: ghIssues.parentPosition,
    })
    .from(ghIssues);
  return rows
    .filter((row) => row.parent !== null)
    .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
    .map((row) => [row.number, row.parent, row.place]);
}

describe.skipIf(!testServer)('EI-1 the sweep reads an epic sub-issue list', () => {
  it('records each sub-issue with its parent and its place, and the epic count', () =>
    withAppDatabase(async (db) => {
      const children = [issue(42), issue(41), issue(43)];
      const { lines } = await sweepOnce(db, app, { github: withEpic(children), at: firstRun });
      expect(await parents(db)).toEqual([
        [42, epicId, 0],
        [41, epicId, 1],
        [43, epicId, 2],
      ]);
      const [epic] = await db.select().from(ghIssues).where(eq(ghIssues.githubId, epicId));
      expect(epic?.subIssues).toBe(3);
      expect(recordedIn(lines)).toBe(true);
    }));

  it('clears the parent of a sub-issue the list no longer names', () =>
    withAppDatabase(async (db) => {
      await sweepOnce(db, app, { github: withEpic([issue(41), issue(42)]), at: firstRun });
      await sweepOnce(db, app, { github: withEpic([issue(42)]), at: nextRun });
      expect(await parents(db)).toEqual([[42, epicId, 0]]);
    }));

  it('does not record a sub-issue in another repository', () =>
    withAppDatabase(async (db) => {
      const foreign = issue(9, {
        id: 9100000999,
        repository_url: 'https://api.github.com/repos/unfoldingWord/other',
      });
      await sweepOnce(db, app, { github: withEpic([issue(41), foreign]), at: firstRun });
      expect(await parents(db)).toEqual([[41, epicId, 0]]);
    }));
});
