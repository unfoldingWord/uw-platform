import type {
  AssistantChannel,
  AssistantEffectKind,
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
export type RequestPlace = { readonly recordedAt: Date; readonly id: string };
export type ThreadQuery = {
  readonly harnessId: string;
  readonly channel: AssistantChannel;
  readonly threadKey: string;
  readonly before: RequestPlace;
  readonly since: Date;
  readonly limit: number;
};
export type AssistantRequestsGateway = {
  readonly read: {
    byId(requestId: string): Promise<AssistantRequestRow | null>;
    byExternal(channel: AssistantChannel, externalId: string): Promise<AssistantRequestRow | null>;
    deliveredInThread(query: ThreadQuery): Promise<readonly AssistantRequestRow[]>;
  };
  readonly write: { insert(row: AssistantRequestRow): Promise<void> };
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
};
export type AssistantEffectsGateway = {
  readonly read: {
    byKey(harnessId: string, idempotencyKey: string): Promise<AssistantEffectRow | null>;
    forRequests(requestIds: readonly string[]): Promise<readonly AssistantEffectRow[]>;
  };
  readonly write: { insert(row: AssistantEffectRow): Promise<boolean> };
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
