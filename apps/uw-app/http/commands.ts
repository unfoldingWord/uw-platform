import type { Context } from 'hono';
import { z } from 'zod';
import type { Outcome } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { refuse } from './outcomes.ts';
import type { CommandResult } from '../acl/grant-commands.ts';

const requestIdOnly = z.object({ requestId: z.uuid() });

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export function malformed(c: Context<AppEnv>, body: unknown): Response {
  const carried = requestIdOnly.safeParse(body);
  if (!carried.success) return refuse(c, 'malformed_command');
  c.set('outcome', 'malformed_command');
  return c.json(
    { status: 'error', requestId: carried.data.requestId, reason: 'malformed_command' },
    400,
  );
}

export function toOutcome(requestId: string, result: CommandResult): Outcome {
  if (result.ok) return { status: 'accepted', requestId };
  return { status: 'error', requestId, reason: result.reason };
}
