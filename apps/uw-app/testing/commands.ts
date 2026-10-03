import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  acceptedOutcomeSchema,
  errorOutcomeSchema,
  refusalSchema,
  type HarnessEvent,
  type ItemState,
  type Outcome,
  type Principal,
  type Refusal,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import {
  software,
  type Caller,
  type EventPage,
  type EventQuery,
  type KernelOutcome,
} from '@uw/harness';
import { createApp } from '../app.tsx';
import type { DatabaseHandle } from '../database.ts';
import { createAccessFixture, fixtureAccessEnv, type AccessFixture } from './access-keys.ts';
import { kernelOn, personOn } from './kernel.ts';
import { postgresDeps } from './postgres.ts';
import { executeCommand, type DispatchScope } from '../commands/dispatch.ts';
import type { PersonDeps } from '../commands/person-deps.ts';
import { noGateGitHub } from '../commands/person-deps.ts';
import { commandRegistry } from '../commands/registry.ts';
import { hubNotWired } from '../ports/hub.not-wired.ts';
import { runsNotWired } from '../ports/runs.not-wired.ts';

const IAN = 'ian.lindsley@unfoldingword.org';
const IAN_ID = '00000000-0000-4000-8000-000000000001';
const AREA = '80-89';

export const responseSchema = z.union([
  acceptedOutcomeSchema.strict(),
  errorOutcomeSchema.strict(),
  refusalSchema.strict(),
]);

export type Sent = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
  readonly traceId: string;
};

export type Person = { readonly id: string; readonly email: string; readonly grantId: string };

export type Scene = {
  readonly harnessId: string;
  readonly otherHarnessId: string;
  readonly editor: Person;
  readonly viewer: Person;
  readonly stranger: Person;
};

let fixture: Promise<AccessFixture> | null = null;

function accessFixture(): Promise<AccessFixture> {
  fixture ??= createAccessFixture();
  return fixture;
}

export async function post(
  db: Database,
  email: string,
  path: string,
  body: unknown,
  person: PersonDeps = noGateGitHub,
): Promise<Sent> {
  const keys = await accessFixture();
  const token = await keys.sign({ email });
  const raw = await createApp(postgresDeps(db, keys), person).request(
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
    },
    fixtureAccessEnv,
  );
  const text = await raw.text();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return { status: raw.status, body: parsed, text, traceId: raw.headers.get('x-trace-id') ?? '' };
}

export async function get(
  db: Database,
  claims: Readonly<Record<string, unknown>>,
  path: string,
): Promise<Sent> {
  const keys = await accessFixture();
  const token = await keys.sign({ ...claims });
  const raw = await createApp(postgresDeps(db, keys), noGateGitHub).request(
    path,
    { method: 'GET', headers: { 'cf-access-jwt-assertion': token } },
    fixtureAccessEnv,
  );
  const text = await raw.text();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return { status: raw.status, body: parsed, text, traceId: raw.headers.get('x-trace-id') ?? '' };
}

export function command(
  db: Database,
  person: Pick<Person, 'email'>,
  harnessId: string,
  name: string,
  body: Readonly<Record<string, unknown>>,
): Promise<Sent> {
  return post(db, person.email, `/api/harness/${harnessId}/commands/${name}`, {
    command: name,
    ...body,
  });
}

export async function allEvents(db: Database, harnessId: string): Promise<HarnessEvent[]> {
  const kernel = kernelOn(db, { now: () => new Date() });
  const caller = callerOf(await ian(db));
  const events: HarnessEvent[] = [];
  let after: number | null = 0;
  while (after !== null) {
    const query: EventQuery = { harnessId, itemId: null, after, limit: 100 };
    const page: EventPage = accepted(await kernel.events.read(caller, query));
    events.push(...page.events);
    after = page.next;
  }
  return events;
}

export async function eventsNamed(
  db: Database,
  harnessId: string,
  name: string,
): Promise<HarnessEvent[]> {
  return (await allEvents(db, harnessId)).filter((event) => event.name === name);
}

export async function eventCount(db: Database, harnessId: string): Promise<number> {
  return (await allEvents(db, harnessId)).length;
}

async function person(db: Database, name: string, role: 'editor' | 'viewer', area: string) {
  const seeded = { id: randomUUID(), email: `${name}@unfoldingword.org`, grantId: randomUUID() };
  await seedPerson(db, { id: seeded.id, email: seeded.email });
  await seedGrant(db, {
    id: seeded.grantId,
    personId: seeded.id,
    role,
    scopeKind: 'jd_area',
    scopeArea: area,
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  return seeded;
}

export function accepted<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

export function callerOf(actor: Principal): Caller {
  return { actor, traceId: randomUUID() };
}

export async function ian(db: Database): Promise<Principal> {
  return personOn(db, IAN_ID, IAN, new Date());
}

async function activated(db: Database, harnessKey: string, repository: string): Promise<string> {
  const harnessId = randomUUID();
  accepted(
    await kernelOn(db, { now: () => new Date() }).stages.activate(callerOf(await ian(db)), {
      harnessId,
      harnessKey,
      jdArea: AREA,
      template: software,
      repository,
    }),
  );
  return harnessId;
}

export async function softwareHarness(db: Database): Promise<Scene> {
  return {
    harnessId: await activated(db, 'software', 'unfoldingWord/uw-platform'),
    otherHarnessId: await activated(db, 'software-two', 'unfoldingWord/uw-other'),
    editor: await person(db, 'ed', 'editor', AREA),
    viewer: await person(db, 'vw', 'viewer', AREA),
    stranger: await person(db, 'fv', 'viewer', '20-29'),
  };
}

export async function enqueued(db: Database, harnessId: string, title: string): Promise<string> {
  const kernel = kernelOn(db, { now: () => new Date() });
  const item = accepted(
    await kernel.items.enqueue(callerOf(await ian(db)), {
      harnessId,
      title,
      pageId: null,
      priority: 0,
      due: null,
      delegationId: null,
    }),
  );
  return item.itemId;
}

export async function itemState(db: Database, itemId: string): Promise<ItemState> {
  const kernel = kernelOn(db, { now: () => new Date() });
  return accepted(await kernel.reads.item(callerOf(await ian(db)), { itemId })).item;
}

function handleOn(db: Database): DatabaseHandle {
  return { db, ping: async () => undefined, release: async () => undefined };
}

export function dispatchScope(db: Database, overrides: Partial<DispatchScope> = {}): DispatchScope {
  return {
    database: handleOn(db),
    registry: commandRegistry,
    gateGitHub: () => null,
    hub: hubNotWired,
    runs: runsNotWired,
    logger: createLogger(
      { traceId: randomUUID(), commit: 'test', route: 'POST', principal: null },
      () => undefined,
    ),
    ...overrides,
  };
}

export function dispatchAs(
  principal: Principal,
  harnessId: string,
  name: string,
  body: Readonly<Record<string, unknown>>,
  scope: DispatchScope,
): Promise<Outcome | Refusal> {
  return executeCommand(
    {
      name,
      harness: harnessId,
      body: { command: name, ...body },
      principal,
      traceId: randomUUID(),
      at: new Date(),
    },
    scope,
  );
}
