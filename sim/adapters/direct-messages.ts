import type { DirectDelivery, DirectMessage, DirectMessages } from '@uw/harness';

type FailedOutcome = Exclude<DirectDelivery['outcome'], 'sent'>;

export type SimDirectMessages = DirectMessages & {
  sent(): readonly DirectMessage[];
  failNextWith(outcome: FailedOutcome): void;
};

type SimState = {
  readonly sent: DirectMessage[];
  readonly effects: Set<string>;
  failing: FailedOutcome | null;
};

function sendIn(state: SimState): DirectMessages['send'] {
  return async (message) => {
    const failing = state.failing;
    state.failing = null;
    if (state.effects.has(message.effectId)) return { outcome: 'sent' };
    if (failing !== null) return { outcome: failing };
    state.effects.add(message.effectId);
    state.sent.push(structuredClone(message));
    return { outcome: 'sent' };
  };
}

export function createSimDirectMessages(): SimDirectMessages {
  const state: SimState = { sent: [], effects: new Set(), failing: null };
  return {
    send: sendIn(state),
    sent: () => state.sent.map((message) => structuredClone(message)),
    failNextWith: (outcome) => {
      state.failing = outcome;
    },
  };
}
