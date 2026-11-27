import type {
  AssistantChannel,
  AssistantEffectKind,
  AssistantHoldStatus,
  AssistantPairingVia,
  AssistantReminderStatus,
  EventName,
  UntrustedPart,
} from '@uw/contracts';

export type AssistantSettingsRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly instructionsMd: string;
  readonly timezone: string;
  readonly version: number;
  readonly updatedAt: Date;
};
export type AssistantSettingsGateway = {
  readonly read: { byHarness(harnessId: string): Promise<AssistantSettingsRow | null> };
  readonly write: { upsert(row: AssistantSettingsRow, expectedVersion: number): Promise<boolean> };
};

export type AssistantRequestRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly personId: string;
  readonly channel: AssistantChannel;
  readonly externalId: string;
  readonly threadKey: string | null;
  readonly replyAddress: string;
  readonly note: string;
  readonly untrustedParts: readonly UntrustedPart[];
  readonly receivedAt: Date;
  readonly recordedAt: Date;
};
export type RecentRequest = AssistantRequestRow & { readonly redactedAt: Date | null };
export type RedactQuery = {
  readonly harnessId: string | null;
  readonly before: Date;
  readonly at: Date;
  readonly limit: number;
};
export type RedactedRequest = { readonly id: string; readonly harnessId: string };
export type RequestPlace = { readonly recordedAt: Date; readonly id: string };
export type ThreadQuery = {
  readonly harnessId: string;
  readonly channel: AssistantChannel;
  readonly threadKey: string;
  readonly before: RequestPlace;
  readonly since: Date;
  readonly limit: number;
};
export type UnstartedQuery = {
  readonly recordedBefore: Date;
  readonly since: Date;
  readonly limit: number;
};
export type AssistantRequestsGateway = {
  readonly read: {
    unstarted(query: UnstartedQuery): Promise<readonly string[]>;
    byId(requestId: string): Promise<AssistantRequestRow | null>;
    byExternal(channel: AssistantChannel, externalId: string): Promise<AssistantRequestRow | null>;
    deliveredInThread(query: ThreadQuery): Promise<readonly AssistantRequestRow[]>;
    countSince(harnessId: string, since: Date): Promise<number>;
    recent(harnessId: string, limit: number): Promise<readonly RecentRequest[]>;
  };
  readonly write: {
    insert(row: AssistantRequestRow): Promise<void>;
    redact(query: RedactQuery): Promise<readonly RedactedRequest[]>;
  };
};

export type AssistantEffectPayload = Readonly<Record<string, unknown>>;
export type AssistantEffectRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly requestId: string;
  readonly kind: AssistantEffectKind;
  readonly idempotencyKey: string;
  readonly payload: AssistantEffectPayload;
  readonly createdAt: Date;
  readonly proposalId?: string;
};
export type AssistantEffectsGateway = {
  readonly read: {
    byId(effectId: string): Promise<AssistantEffectRow | null>;
    byKey(harnessId: string, idempotencyKey: string): Promise<AssistantEffectRow | null>;
    forRequests(requestIds: readonly string[]): Promise<readonly AssistantEffectRow[]>;
    countSince(harnessId: string, kind: AssistantEffectKind, since: Date): Promise<number>;
    openProposals(startedBefore: Date, limit: number): Promise<readonly AssistantEffectRow[]>;
    settled(harnessId: string, effectId: string): Promise<boolean>;
  };
  readonly write: {
    insert(row: AssistantEffectRow): Promise<boolean>;
    redactFor(requestIds: readonly string[], at: Date): Promise<number>;
  };
};

export type AssistantReminderRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly personId: string;
  readonly requestId: string;
  readonly effectId: string;
  readonly text: string;
  readonly dueAt: Date;
  readonly status: AssistantReminderStatus;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
};
export type ReminderClose = {
  readonly id: string;
  readonly from: AssistantReminderStatus;
  readonly to: AssistantReminderStatus;
  readonly at: Date;
};
export type AssistantRemindersGateway = {
  readonly read: {
    byId(reminderId: string): Promise<AssistantReminderRow | null>;
    byEffect(effectId: string): Promise<AssistantReminderRow | null>;
    due(at: Date, limit: number): Promise<readonly AssistantReminderRow[]>;
    pending(harnessId: string, limit: number): Promise<readonly AssistantReminderRow[]>;
  };
  readonly write: {
    insert(row: AssistantReminderRow): Promise<void>;
    close(change: ReminderClose): Promise<boolean>;
    redact(query: RedactQuery): Promise<number>;
  };
};

export type AssistantBindingRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly channel: AssistantChannel;
  readonly address: string;
  readonly via: AssistantPairingVia;
  readonly boundAt: Date;
};
export type AssistantBindingsGateway = {
  readonly read: {
    of(harnessId: string, channel: AssistantChannel): Promise<AssistantBindingRow | null>;
    byAddress(channel: AssistantChannel, address: string): Promise<AssistantBindingRow | null>;
  };
  readonly write: { put(row: AssistantBindingRow): Promise<void> };
};

export type AssistantPairingCodeRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly channel: AssistantChannel;
  readonly codeDigest: string;
  readonly expiresAt: Date;
  readonly attempts: number;
  readonly createdAt: Date;
};
export type AssistantPairingCodesGateway = {
  readonly read: {
    of(harnessId: string, channel: AssistantChannel): Promise<AssistantPairingCodeRow | null>;
  };
  readonly write: {
    put(row: AssistantPairingCodeRow): Promise<void>;
    attempted(harnessId: string, channel: AssistantChannel, attempts: number): Promise<void>;
    remove(harnessId: string, channel: AssistantChannel): Promise<void>;
  };
};

export type AssistantLedgerSubject = { readonly requestId: string } | { readonly effectId: string };
export type AssistantLedgerQuery = {
  readonly harnessId: string;
  readonly names: readonly EventName[];
  readonly about: AssistantLedgerSubject;
  readonly limit: number;
};
export type AssistantMonthQuery = { readonly harnessId: string; readonly since: Date };
export type AssistantMonthSpend = {
  readonly knownMicros: number;
  readonly unknownTurns: number;
  readonly openTurns: number;
};

export type AssistantStaleTurnQuery = {
  readonly startedBefore: Date;
  readonly since: Date;
  readonly limit: number;
};
export type AssistantStaleTurn = {
  readonly harnessId: string;
  readonly requestId: string;
  readonly turnId: string;
  readonly startedAt: Date;
};

export type AssistantBudgetRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly monthlyMinor: number;
  readonly setBy: string;
  readonly setAt: Date;
};
export type AssistantPoolBudgets = {
  readonly enabled: number;
  readonly overridden: number;
  readonly overriddenMinor: number;
};
export type AssistantBudgetsGateway = {
  readonly read: {
    of(harnessId: string): Promise<AssistantBudgetRow | null>;
    pool(at: Date, since: Date): Promise<AssistantPoolBudgets>;
  };
  readonly write: {
    put(row: AssistantBudgetRow): Promise<void>;
    remove(harnessId: string): Promise<void>;
  };
};

export type AssistantHoldRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly personId: string;
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: AssistantHoldStatus;
  readonly releasedEffectId: string | null;
  readonly releasedAt: Date | null;
  readonly createdAt: Date;
};
export type HoldRelease = {
  readonly id: string;
  readonly effectId: string | null;
  readonly at: Date;
};
export type AssistantHoldsGateway = {
  readonly read: {
    byId(holdId: string): Promise<AssistantHoldRow | null>;
    held(harnessId: string, limit: number): Promise<readonly AssistantHoldRow[]>;
  };
  readonly write: {
    insert(row: AssistantHoldRow): Promise<boolean>;
    release(change: HoldRelease): Promise<boolean>;
    redact(query: RedactQuery): Promise<number>;
  };
};
