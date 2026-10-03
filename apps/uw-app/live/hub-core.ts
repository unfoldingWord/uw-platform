import { z } from 'zod';
import { hubWakeSchema } from '@uw/contracts';

export type HubSocket = {
  readonly readyState: number;
  send(message: string): void;
  close(code: number, reason: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

export type HubState = {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): readonly HubSocket[];
  readonly storage: {
    get(key: string): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number): Promise<void>;
  };
};

export type HubTimers = { setTimeout(run: () => void, ms: number): unknown };

type HubStats = { readonly connections: number; readonly lastWakeAt: string | null };

type HubCore = {
  wake(harnessId: string): void;
  stats(): Promise<HubStats>;
  admit(socket: HubSocket, person: string): Promise<void>;
  shed(): Promise<void>;
};

export const SOCKET_MAX_AGE_MS = 3_600_000;
export const SOCKETS_PER_PERSON = 100;

const LAST_WAKE = 'lastWakeAt';
const OPEN = 1;
const NORMAL_CLOSURE = 1000;
const PERSON_HEADER = 'x-hub-person';
const wakeRequestSchema = z.strictObject({ harnessId: z.uuid() });
const tagSchema = z.strictObject({ openedAt: z.number().int().nonnegative(), person: z.uuid() });
const personSchema = z.uuid();

type Tag = z.infer<typeof tagSchema>;
type Tagged = { readonly socket: HubSocket; readonly tag: Tag };

function sendTo(socket: HubSocket, message: string): void {
  try {
    socket.send(message);
  } catch {
    return;
  }
}

function closeSocket(socket: HubSocket): void {
  try {
    socket.close(NORMAL_CLOSURE, 'closed');
  } catch {
    return;
  }
}

function tagOf(socket: HubSocket): Tag | null {
  try {
    const parsed = tagSchema.safeParse(socket.deserializeAttachment());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function openSockets(state: HubState): readonly HubSocket[] {
  return state.getWebSockets().filter((socket) => socket.readyState === OPEN);
}

function broadcast(state: HubState, harnessId: string): void {
  const message = JSON.stringify(hubWakeSchema.parse({ type: 'wake', harnessId }));
  for (const socket of openSockets(state)) sendTo(socket, message);
}

async function scheduleShed(state: HubState, live: readonly Tagged[], at: number): Promise<void> {
  const oldest = Math.min(...live.map(({ tag }) => tag.openedAt));
  if (!Number.isFinite(oldest)) return;
  const due = oldest + SOCKET_MAX_AGE_MS;
  const set = await state.storage.getAlarm();
  if (set === null || set <= at || set > due) await state.storage.setAlarm(due);
}

async function shedOld(state: HubState, at: number): Promise<void> {
  const live: Tagged[] = [];
  for (const socket of openSockets(state)) {
    const tag = tagOf(socket);
    if (tag === null || at - tag.openedAt >= SOCKET_MAX_AGE_MS) closeSocket(socket);
    else live.push({ socket, tag });
  }
  await scheduleShed(state, live, at).catch(() => undefined);
}

function capPerson(state: HubState, person: string): void {
  const own = openSockets(state)
    .map((socket) => ({ socket, tag: tagOf(socket) }))
    .filter((entry): entry is Tagged => entry.tag?.person === person)
    .sort((left, right) => left.tag.openedAt - right.tag.openedAt);
  for (const { socket } of own.slice(0, Math.max(0, own.length - SOCKETS_PER_PERSON))) {
    closeSocket(socket);
  }
}

export function createHubCore(state: HubState, timers: HubTimers, now: () => Date): HubCore {
  const pending = new Set<string>();
  const shed = () => shedOld(state, now().getTime());
  const flush = async () => {
    const woken = [...pending];
    pending.clear();
    await shed();
    for (const harnessId of woken) broadcast(state, harnessId);
    await state.storage.put(LAST_WAKE, now().toISOString()).catch(() => undefined);
  };
  return {
    wake: (harnessId) => {
      const first = pending.size === 0;
      pending.add(harnessId);
      if (first) timers.setTimeout(() => void flush(), 0);
    },
    stats: async () => {
      const last = await state.storage.get(LAST_WAKE);
      return {
        connections: openSockets(state).length,
        lastWakeAt: typeof last === 'string' ? last : null,
      };
    },
    admit: async (socket, person) => {
      socket.serializeAttachment({ openedAt: now().getTime(), person });
      capPerson(state, person);
      await shed();
    },
    shed,
  };
}

async function connect(core: HubCore, state: HubState, request: Request): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response(null, { status: 426 });
  }
  const person = personSchema.safeParse(request.headers.get(PERSON_HEADER));
  if (!person.success) return new Response(null, { status: 400 });
  const pair = new WebSocketPair();
  state.acceptWebSocket(pair[1]);
  await core.admit(pair[1], person.data);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

async function wake(core: HubCore, request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = wakeRequestSchema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });
  core.wake(parsed.data.harnessId);
  return new Response(null, { status: 202 });
}

export async function hubFetch(
  core: HubCore,
  state: HubState,
  request: Request,
): Promise<Response> {
  const route = `${request.method} ${new URL(request.url).pathname}`;
  if (route === 'GET /connect') return connect(core, state, request);
  if (route === 'POST /wake') return wake(core, request);
  if (route === 'GET /stats') return Response.json(await core.stats());
  return new Response(null, { status: 404 });
}
