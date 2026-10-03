import { DurableObject } from 'cloudflare:workers';
import type { Bindings } from '../env.ts';
import { systemClock } from '../ports/clock.ts';
import { createHubCore, hubFetch, type HubState } from './hub-core.ts';

type HubContext = Pick<
  DurableObjectState,
  'acceptWebSocket' | 'getWebSockets' | 'setWebSocketAutoResponse'
> & { readonly storage: HubState['storage'] };

type OpenHub = { readonly state: HubState; readonly core: ReturnType<typeof createHubCore> };

const NORMAL_CLOSURE = 1000;

export function openHub(ctx: HubContext): OpenHub {
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  const state: HubState = {
    acceptWebSocket: (socket) => ctx.acceptWebSocket(socket),
    getWebSockets: () => ctx.getWebSockets(),
    storage: {
      get: (key) => ctx.storage.get(key),
      put: (key, value) => ctx.storage.put(key, value),
      getAlarm: () => ctx.storage.getAlarm(),
      setAlarm: (scheduledTime) => ctx.storage.setAlarm(scheduledTime),
    },
  };
  return { state, core: createHubCore(state, { setTimeout }, () => systemClock.now()) };
}

export function closeNormally(socket: Pick<WebSocket, 'close'>): void {
  try {
    socket.close(NORMAL_CLOSURE, 'closed');
  } catch {
    return;
  }
}

export class HarnessHub extends DurableObject<Bindings> {
  private readonly hub: OpenHub;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.hub = openHub(ctx);
  }

  override fetch(request: Request): Promise<Response> {
    return hubFetch(this.hub.core, this.hub.state, request);
  }

  override alarm(): Promise<void> {
    return this.hub.core.shed();
  }

  override webSocketMessage(): void {
    return undefined;
  }

  override webSocketClose(socket: WebSocket): void {
    closeNormally(socket);
  }
}
