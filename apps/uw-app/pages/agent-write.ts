import type { z } from 'zod';
import type { Page, PageStatus, verbIo } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Kernel } from '@uw/harness';
import { isGatedType } from './gating.ts';
import { createPage, updateCheckedPage, type PageRefusal, type PageResult } from './store.ts';

type AgentPage = z.infer<(typeof verbIo)['write_page']['input']>;

type AgentRequest = {
  readonly traceId: string;
  readonly at: Date;
  readonly instructions: Pick<Kernel['reads'], 'namesInstructions'>;
};

function refusedWith(reason: PageRefusal['reason'], detail: PageRefusal['detail']): PageRefusal {
  return { ok: false, reason, detail };
}

function statusFor(input: AgentPage, expectedVersion: number, instructions: boolean) {
  return (stored: Page): PageStatus | PageRefusal => {
    if (stored.version !== expectedVersion) return refusedWith('stale_version', {});
    const moved = [
      ...(stored.type === input.type ? [] : ['type']),
      ...(stored.jdArea === input.jdArea ? [] : ['jdArea']),
    ];
    if (moved.length > 0) return refusedWith('malformed_command', { fields: moved });
    if (instructions) return refusedWith('not_permitted', { why: 'stage_instructions' });
    if (isGatedType(stored.type) && stored.status !== 'suggested') {
      return refusedWith('not_permitted', { why: 'gated_page' });
    }
    return stored.status;
  };
}

export async function writePageAsAgent(
  db: Database,
  actor: Principal,
  input: AgentPage,
  request: AgentRequest,
): Promise<PageResult | PageRefusal> {
  const { traceId, at } = request;
  const { expectedVersion, type, jdArea, ...editable } = input;
  if (expectedVersion === null) {
    const status = isGatedType(type) ? 'suggested' : 'draft';
    const command = { command: 'create_page' as const, requestId: crypto.randomUUID() };
    return createPage(db, actor, { ...command, ...editable, type, jdArea, status }, traceId, at);
  }
  const instructions = await request.instructions.namesInstructions({ pageId: input.pageId });
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    ...editable,
    expectedVersion,
  };
  const checked = { command, statusFor: statusFor(input, expectedVersion, instructions) };
  return updateCheckedPage(db, actor, checked, traceId, at);
}
