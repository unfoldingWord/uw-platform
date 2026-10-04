import {
  chooseInWindow,
  POSTING_REASONS,
  type CooldownWindow,
  type Notifier,
  type PushDecision,
  type Wake,
  type WakeReason,
  type WakeRecipient,
  type ZulipDecision,
} from '@uw/harness';

type SimDecision = {
  readonly traceId: string;
  readonly personId: string;
  readonly decision: PushDecision;
};
type SimPost = {
  readonly topic: string;
  readonly reason: WakeReason;
  readonly traceId: string;
};

export type SimNotifier = Notifier & {
  delivered(): readonly Wake[];
  failNext(): void;
  subscribe(personId: string): void;
  enableZulip(): void;
  decisions(): readonly SimDecision[];
  posts(): readonly SimPost[];
};

type SimState = {
  readonly delivered: Wake[];
  readonly devices: Set<string>;
  readonly windows: Map<string, CooldownWindow>;
  readonly decisions: SimDecision[];
  readonly posts: SimPost[];
  failing: boolean;
  zulip: boolean;
};

function pushDecision(
  state: SimState,
  wake: Wake,
  recipient: WakeRecipient,
  failing: boolean,
): PushDecision {
  if (recipient.present) return 'suppressed';
  if (!state.devices.has(recipient.personId)) return 'no_device';
  const choice = chooseInWindow(
    state.windows.get(recipient.personId) ?? null,
    wake.reason,
    wake.at,
  );
  if (choice.decision === 'coalesce') return 'coalesced';
  state.windows.set(recipient.personId, choice.window);
  return failing ? 'dropped' : 'sent';
}

function zulipDecision(state: SimState, wake: Wake, failing: boolean): ZulipDecision {
  if (!state.zulip) return 'not_configured';
  if (!POSTING_REASONS.has(wake.reason)) return 'not_posted';
  if (failing) return 'dropped';
  state.posts.push({ topic: wake.topic, reason: wake.reason, traceId: wake.traceId });
  return 'posted';
}

function notifyIn(state: SimState): Notifier['notify'] {
  return async (wake) => {
    const failing = state.failing;
    state.failing = false;
    state.delivered.push(structuredClone(wake));
    const push = wake.recipients.map((recipient) => {
      const decision = pushDecision(state, wake, recipient, failing);
      state.decisions.push({ traceId: wake.traceId, personId: recipient.personId, decision });
      return { personId: recipient.personId, decision };
    });
    return { push, zulip: zulipDecision(state, wake, failing) };
  };
}

export function createSimNotifier(): SimNotifier {
  const state: SimState = {
    delivered: [],
    devices: new Set(),
    windows: new Map(),
    decisions: [],
    posts: [],
    failing: false,
    zulip: false,
  };
  return {
    notify: notifyIn(state),
    delivered: () => state.delivered.map((wake) => structuredClone(wake)),
    failNext: () => {
      state.failing = true;
    },
    subscribe: (personId) => {
      state.devices.add(personId);
    },
    enableZulip: () => {
      state.zulip = true;
    },
    decisions: () => [...state.decisions],
    posts: () => [...state.posts],
  };
}
