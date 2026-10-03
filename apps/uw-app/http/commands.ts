import type { Context } from 'hono';
import { z } from 'zod';
import type { ErrorReason, Outcome, Refusal } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { boundedJson } from './body.ts';
import { refuse, reply } from './outcomes.ts';

export type CommandResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };

const requestIdOnly = z.object({ requestId: z.uuid() });

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  const read = await boundedJson(c.req.raw);
  return read.ok ? read.value : null;
}

export function malformedOutcome(body: unknown): Outcome | Refusal {
  const carried = requestIdOnly.safeParse(body);
  if (!carried.success) return { status: 'error', reason: 'malformed_command' };
  return { status: 'error', requestId: carried.data.requestId, reason: 'malformed_command' };
}

export function answer(c: Context<AppEnv>, outcome: Outcome | Refusal): Response {
  return 'requestId' in outcome ? reply(c, outcome) : refuse(c, outcome.reason);
}

export function malformed(c: Context<AppEnv>, body: unknown): Response {
  return answer(c, malformedOutcome(body));
}

export function toOutcome(requestId: string, result: CommandResult): Outcome {
  if (result.ok) return { status: 'accepted', requestId };
  return { status: 'error', requestId, reason: result.reason };
}
