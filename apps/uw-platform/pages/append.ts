import type { Page } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { replayOf } from './replay.ts';
import {
  lockedPage,
  pageConflict,
  updateWithin,
  type PageRefusal,
  type PageResult,
} from './store.ts';

export type Appending = {
  readonly pageId: string;
  readonly block: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly at: Date;
};
export type AppendOutcome =
  | { readonly outcome: 'appended'; readonly version: number }
  | { readonly outcome: 'page_not_found' | 'not_permitted' | 'refused' };

function outcomeOf(result: PageResult | PageRefusal): AppendOutcome {
  if (result.ok) return { outcome: 'appended', version: result.page.version };
  if (result.reason === 'page_not_found') return { outcome: 'page_not_found' };
  if (result.reason === 'not_permitted') return { outcome: 'not_permitted' };
  return { outcome: 'refused' };
}

function appendedTo(stored: Page, change: Appending) {
  return {
    command: {
      command: 'update_page',
      requestId: change.requestId,
      pageId: stored.id,
      expectedVersion: stored.version,
      slug: stored.slug,
      title: stored.title,
      parentId: stored.parentId,
      frontmatter: stored.frontmatter,
      bodyMd: `${stored.bodyMd}\n\n${change.block}`,
    },
    statusFor: () => stored.status,
  } as const;
}

async function appendIn(db: Database, actor: Principal, change: Appending) {
  return db.transaction(async (tx) => {
    const stored = await lockedPage(tx, actor, change.pageId, change.at);
    if (stored === null) return outcomeOf({ ok: false, reason: 'page_not_found' });
    if (!can(actor, 'write', { kind: 'area', area: stored.jdArea }, change.at)) {
      return outcomeOf({ ok: false, reason: 'not_permitted' });
    }
    const request = { traceId: change.traceId, at: change.at };
    return outcomeOf(await updateWithin(tx, actor, appendedTo(stored, change), request));
  });
}

export async function appendToPage(
  db: Database,
  actor: Principal,
  change: Appending,
): Promise<AppendOutcome> {
  const replayed = await replayOf(db, actor, change.requestId);
  if (replayed !== null) {
    return replayed.id === change.pageId
      ? { outcome: 'appended', version: replayed.version }
      : { outcome: 'refused' };
  }
  try {
    return await appendIn(db, actor, change);
  } catch (error) {
    return outcomeOf(await pageConflict(error));
  }
}
