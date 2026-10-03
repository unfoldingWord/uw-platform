import type { Context } from 'hono';
import { z } from 'zod';
import {
  eventPageReplySchema,
  eventQuerySchema,
  itemStateSchema,
  stageKeySchema,
  type ItemState,
} from '@uw/contracts';
import { stagePageLimit, type Caller, type Clock, type StageCursor } from '@uw/harness';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { platformKernel } from '../kernel.ts';

const harnessParam = z.uuid();
const noStage = '';
const cursorShape = /^(-?\d{1,10})\.([0-9a-f-]{36})$/;
const cursorId = z.uuid();
const wholeNumber = /^(?:0|[1-9]\d{0,15})$/;
const numericParams: ReadonlySet<string> = new Set(['after', 'limit']);

function eventQueryOf(raw: Readonly<Record<string, string>>) {
  const numeric = Object.entries(raw).every(
    ([key, value]) => !numericParams.has(key) || wholeNumber.test(value),
  );
  const parsed = eventQuerySchema.safeParse(raw);
  return numeric && parsed.success ? parsed.data : null;
}

function cursorOf(raw: string | undefined): StageCursor | null | 'malformed' {
  if (raw === undefined) return null;
  const match = cursorShape.exec(raw);
  const itemId = cursorId.safeParse(match?.[2]);
  const priority = Number(match?.[1]);
  if (!itemId.success || !Number.isSafeInteger(priority)) return 'malformed';
  return { priority, itemId: itemId.data };
}

function nextOf(items: readonly ItemState[]): string | null {
  const last = items.at(-1);
  if (items.length < stagePageLimit || last === undefined) return null;
  return `${last.priority}.${last.itemId}`;
}

export async function stageItems(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const harness = harnessParam.safeParse(c.req.param('harness'));
  if (!harness.success) return refuse(c, 'harness_not_found');
  const after = cursorOf(c.req.query('after'));
  if (after === 'malformed') return refuse(c, 'malformed_command');
  const stage = stageKeySchema.safeParse(c.req.param('stage'));
  const at = c.get('now');
  const clock: Clock = { now: () => at };
  const kernel = platformKernel(database, clock);
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const stageKey = stage.success ? stage.data : noStage;
  const input = { harnessId: harness.data, stageKey, after, limit: stagePageLimit };
  const read = await kernel.reads.inStage(caller, input, { at });
  if (read.status !== 'accepted') return refuse(c, read.reason);
  const items = read.value.map((item) => itemStateSchema.parse(item));
  return c.json({ items, next: nextOf(items) });
}

export async function harnessEvents(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const harness = harnessParam.safeParse(c.req.param('harness'));
  if (!harness.success) return refuse(c, 'harness_not_found');
  const query = eventQueryOf(c.req.query());
  if (query === null) return refuse(c, 'malformed_command');
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const input = {
    harnessId: harness.data,
    itemId: query.item ?? null,
    after: query.after,
    limit: query.limit,
  };
  const read = await kernel.events.read(caller, input, { at });
  if (read.status !== 'accepted') return refuse(c, read.reason);
  return c.json(eventPageReplySchema.parse(read.value));
}
