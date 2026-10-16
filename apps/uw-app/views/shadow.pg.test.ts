import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { shadowComparisonSchema, type ShadowComparison } from '@uw/contracts';
import { ingestPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { seedPlatformPage } from '@uw/db/test-seed';
import { checkOnly } from '@uw/harness';
import { seedPullRequest } from '../testing/github-facts.ts';
import { accepted, callerOf, get, ian, person } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { gatesPath, shadowExportPath } from './parts/paths.ts';

const IAN_EMAIL = 'ian.lindsley@unfoldingword.org';
const repository = 'unfoldingWord/tc-admin-app';
const head = 'c'.repeat(40);
const clock = { now: () => new Date() };

async function shadowHarness(db: Database): Promise<string> {
  const harnessId = randomUUID();
  const kernel = kernelOn(db, clock);
  accepted(
    await kernel.stages.activate(callerOf(await ian(db)), {
      harnessId,
      harnessKey: 'tc-admin-app',
      jdArea: '80-89',
      template: checkOnly,
      repository,
      shadow: true,
      externalReviewerIdentities: [],
    }),
  );
  await seedPlatformPage(db, { id: randomUUID(), jdArea: '80-89', repositories: [repository] });
  const ingest = { actor: ingestPrincipal(), traceId: randomUUID() };
  const pullRequest = { repo: repository, number: 12 };
  accepted(
    await kernel.items.join(ingest, {
      pullRequest,
      head,
      title: 'Fix the login form',
      requestedReviewers: ['uw-reviewer[bot]'],
    }),
  );
  await seedPullRequest(db, {
    repoId: 9100000300,
    pullRequestId: 9100000312,
    repo: repository,
    number: 12,
    head,
    headRef: 'feature/login-form',
    paths: ['apps/uw-app/login.tsx'],
    freshAt: new Date(),
  });
  accepted(await kernel.gates.recordShadowVerdicts(ingest, { pullRequest }));
  return harnessId;
}

function headsOf(comparison: ShadowComparison): string[] {
  return comparison.rows.map((row) => row.head);
}

function sectionFor(document: Document, key: string): Element | undefined {
  return [...document.querySelectorAll('main section')].find((candidate) =>
    candidate.querySelector('h2')?.textContent?.includes(key),
  );
}

describe.skipIf(!testServer)('OB-3 the shadow comparison export', () => {
  it('answers the comparison as JSON for a reader and harness_not_found for an outsider', () =>
    withAppDatabase(async (db) => {
      const harnessId = await shadowHarness(db);
      const read = await get(db, { email: IAN_EMAIL }, shadowExportPath(harnessId));
      expect(read.status).toBe(200);
      const comparison = shadowComparisonSchema.parse(read.body);
      expect(comparison).toMatchObject({ harnessKey: 'tc-admin-app', shadow: true });
      expect(headsOf(comparison)).toEqual([head]);
      const outsider = await person(db, 'shadow-outsider', 'viewer', '20-29');
      const hidden = await get(db, { email: outsider.email }, shadowExportPath(harnessId));
      expect(hidden.body).toMatchObject({ status: 'error', reason: 'harness_not_found' });
    }));
});

describe.skipIf(!testServer)(
  'GL-4 OB-3 the Gates view shows shadow verdicts labelled shadow',
  () => {
    it('lists the head under the harness with the shadow label and an export link, and passes the screen checks', () =>
      withAppDatabase(async (db) => {
        const harnessId = await shadowHarness(db);
        const html = await getHtml(db, IAN_EMAIL, gatesPath(), {}, clock);
        const section = sectionFor(new JSDOM(html.text).window.document, 'tc-admin-app');
        expect(section?.textContent).toContain('shadow');
        expect(section?.querySelector('a')?.getAttribute('href')).toBe(shadowExportPath(harnessId));
        expect(section?.querySelector('table caption')?.textContent).toBe(
          'Shadow verdicts on tc-admin-app',
        );
        expect(await screenProblems(html.text)).toEqual([]);
      }));
  },
);
