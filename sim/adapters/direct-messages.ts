import type { AssistantChannel } from '@uw/contracts';
import type { Clock, DirectDelivery, DirectMessage, DirectMessages } from '@uw/harness';

type FailedOutcome = Exclude<DirectDelivery['outcome'], 'sent'>;

type SendHold = { readonly arrived: Promise<void>; release(): void };

export type SimDirectMessages = DirectMessages & {
  sent(): readonly DirectMessage[];
  failNextWith(outcome: FailedOutcome): void;
  holdNext(): SendHold;
  bind(personId: string, channel: AssistantChannel, address: string): void;
};

type Held = { readonly arrive: () => void; readonly released: Promise<void> };

type SimState = {
  readonly clock: Clock;
  readonly sent: DirectMessage[];
  readonly effects: Set<string>;
  failing: FailedOutcome | null;
  held: Held | null;
  readonly bindings: Map<string, string>;
};

function bindingKey(personId: string, channel: AssistantChannel): string {
  return `${personId} ${channel}`;
}

function sendIn(state: SimState): DirectMessages['send'] {
  return async (message) => {
    const held = state.held;
    state.held = null;
    if (held !== null) {
      held.arrive();
      await held.released;
    }
    const failing = state.failing;
    state.failing = null;
    if (state.effects.has(message.effectId)) return { outcome: 'sent' };
    if (state.clock.now().getTime() >= message.sendBy.getTime()) {
      return { outcome: 'deadline_passed' };
    }
    if (failing !== null) return { outcome: failing };
    const binding = state.bindings.get(bindingKey(message.personId, message.channel));
    if (binding !== message.replyAddress) return { outcome: 'not_paired' };
    state.effects.add(message.effectId);
    state.sent.push(structuredClone(message));
    return { outcome: 'sent' };
  };
}

function holdIn(state: SimState): SendHold {
  let arrive = (): void => undefined;
  let release = (): void => undefined;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.held = { arrive, released };
  return { arrived, release };
}

export function createSimDirectMessages(clock: Clock): SimDirectMessages {
  const state: SimState = {
    clock,
    sent: [],
    effects: new Set(),
    failing: null,
    held: null,
    bindings: new Map(),
  };
  return {
    send: sendIn(state),
    sent: () => state.sent.map((message) => structuredClone(message)),
    failNextWith: (outcome) => {
      state.failing = outcome;
    },
    holdNext: () => holdIn(state),
    bind: (personId, channel, address) => {
      state.bindings.set(bindingKey(personId, channel), address);
    },
  };
}
