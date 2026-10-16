import { describe, expect, it } from 'vitest';
import { newEventSchema } from '@uw/contracts';
import type { Store } from '../ports.ts';
import { at, hour, seedHarness, uid } from './store-gateway-fixtures.ts';

type NotReadySubject = () => { readonly store: Store };

const base = 0x7800;
const page = '00000000-0000-4000-8000-000000003101';
const issue = (githubId: number) => ({ repo: 'unfoldingWord/uw-platform', number: 12, githubId });

function missing(n: number, evidence: Record<string, unknown>) {
  return newEventSchema.parse({
    eventId: uid(base + 0x40 + n),
    harnessId: uid(base),
    itemId: null,
    name: 'done_when_missing',
    at: new Date(at.getTime() + n * hour).toISOString(),
    actor: 'agent:ingest',
    evidence,
    traceId: uid(base + 0x80),
    requestId: null,
  });
}

function eventIds(events: readonly { readonly eventId: string }[]): readonly string[] {
  return events.map((event) => event.eventId);
}

export function describeStoreNotReady(adapter: string, subject: NotReadySubject): void {
  describe(`store finds a not-ready subject's refusal by its issue or page on ${adapter}`, () => {
    it('EI-2 recent keeps to the issue or the page the evidence names', async () => {
      const read = await subject().store.transaction(async (tx) => {
        await seedHarness(tx, base, 'gateway-not-ready');
        await tx.harnessEvents.write.append([
          missing(1, { via: 'import', issue: issue(9100000012), pageId: null, title: 'One' }),
          missing(2, { via: 'import', issue: issue(9100000013), pageId: null, title: 'Two' }),
          missing(3, { via: 'kickstart', issue: null, pageId: page, title: 'Page' }),
        ]);
        const query = { since: at, names: ['done_when_missing' as const], agentsOnly: false };
        const ids = async (scope: { evidenceIssue?: number; evidencePage?: string }) =>
          eventIds(await tx.harnessEvents.read.recent({ ...query, ...scope, limit: 10 }));
        return {
          issue: await ids({ evidenceIssue: 9100000012 }),
          page: await ids({ evidencePage: page }),
          none: await ids({ evidenceIssue: 9100000099 }),
        };
      });
      expect(read).toEqual({
        issue: [uid(base + 0x41)],
        page: [uid(base + 0x43)],
        none: [],
      });
    });
  });
}
