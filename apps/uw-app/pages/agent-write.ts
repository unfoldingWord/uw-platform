import type { z } from 'zod';
import type { Page, PageStatus, PageType, verbIo } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { createPage, updateCheckedPage, type PageRefusal, type PageResult } from './store.ts';

type AgentPage = z.infer<(typeof verbIo)['write_page']['input']>;

const gatedPageTypes: ReadonlySet<PageType> = new Set<PageType>(['learning', 'skill', 'persona']);

function refusedWith(reason: PageRefusal['reason'], detail: PageRefusal['detail']): PageRefusal {
  return { ok: false, reason, detail };
}

function statusFor(input: AgentPage, expectedVersion: number) {
  return (stored: Page): PageStatus | PageRefusal => {
    if (stored.version !== expectedVersion) return refusedWith('stale_version', {});
    const moved = [
      ...(stored.type === input.type ? [] : ['type']),
      ...(stored.jdArea === input.jdArea ? [] : ['jdArea']),
    ];
    if (moved.length > 0) return refusedWith('malformed_command', { fields: moved });
    if (gatedPageTypes.has(stored.type) && stored.status !== 'suggested') {
      return refusedWith('not_permitted', { why: 'gated_page' });
    }
    return stored.status;
  };
}

export function writePageAsAgent(
  db: Database,
  actor: Principal,
  input: AgentPage,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  const { expectedVersion, type, jdArea, ...editable } = input;
  if (expectedVersion === null) {
    const status = gatedPageTypes.has(type) ? 'suggested' : 'draft';
    const command = { command: 'create_page' as const, requestId: crypto.randomUUID() };
    return createPage(db, actor, { ...command, ...editable, type, jdArea, status }, traceId, at);
  }
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    ...editable,
    expectedVersion,
  };
  return updateCheckedPage(
    db,
    actor,
    { command, statusFor: statusFor(input, expectedVersion) },
    traceId,
    at,
  );
}
