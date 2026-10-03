import { z } from 'zod';
import { hubWakeSchema } from '@uw/contracts';

export type HubSocket = { send(message: string): void };

export type HubState = {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): readonly HubSocket[];
  readonly storage: {
    get(key: string): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
};

export type HubTimers = { setTimeout(run: () => void, ms: number): unknown };

type HubStats = { readonly connections: number; readonly lastWakeAt: string | null };

type HubCore = { wake(harnessId: string): void; stats(): Promise<HubStats> };

const LAST_WAKE = 'lastWakeAt';
const wakeRequestSchema = z.strictObject({ harnessId: z.uuid() });

function sendTo(socket: HubSocket, message: string): void {
  try {
    socket.send(message);
  } catch {
    return;
  }
}

function broadcast(state: HubState, harnessId: string): void {
  const message = JSON.stringify(hubWakeSchema.parse({ type: 'wake', harnessId }));
  for (const socket of state.getWebSockets()) sendTo(socket, message);
}

export function createHubCore(state: HubState, timers: HubTimers, now: () => Date): HubCore {
  const pending = new Set<string>();
  const flush = async () => {
    const woken = [...pending];
    pending.clear();
    for (const harnessId of woken) broadcast(state, harnessId);
    await state.storage.put(LAST_WAKE, now().toISOString());
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
        connections: state.getWebSockets().length,
        lastWakeAt: typeof last === 'string' ? last : null,
      };
    },
  };
}

function connect(state: HubState, request: Request): Response {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response(null, { status: 426 });
  }
  const pair = new WebSocketPair();
  state.acceptWebSocket(pair[1]);
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
  if (route === 'GET /connect') return connect(state, request);
  if (route === 'POST /wake') return wake(core, request);
  if (route === 'GET /stats') return Response.json(await core.stats());
  return new Response(null, { status: 404 });
}
