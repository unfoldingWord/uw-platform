import type {
  Harness,
  HarnessEvent,
  Identity,
  ItemState,
  NewHarnessEvent,
  PageStatus,
  PageType,
  PrincipalKind,
  Stage,
} from '@uw/contracts';

export type ItemClaim = {
  readonly itemId: string;
  readonly holder: Identity;
  readonly claimantKind: PrincipalKind;
  readonly delegationId: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly at: Date;
};
export type PageFacts = {
  readonly id: string;
  readonly type: PageType;
  readonly status: PageStatus;
  readonly jdArea: string;
  readonly bodyMd: string;
};
export type StagePosition = { readonly id: string; readonly position: number };

export type HarnessesGateway = {
  readonly read: {
    byId(harnessId: string): Promise<Harness | null>;
    byKey(key: string): Promise<Harness | null>;
    list(): Promise<readonly Harness[]>;
  };
  readonly write: { insert(harness: Harness, at: Date): Promise<void> };
};
export type HarnessStagesGateway = {
  readonly read: { forHarness(harnessId: string): Promise<readonly Stage[]> };
  readonly write: {
    insert(stage: Stage): Promise<void>;
    update(stage: Stage): Promise<void>;
    reposition(harnessId: string, positions: readonly StagePosition[]): Promise<void>;
  };
};
export type HarnessItemsGateway = {
  readonly read: {
    byId(itemId: string): Promise<ItemState | null>;
    lock(itemId: string): Promise<ItemState | null>;
    forHarness(harnessId: string): Promise<readonly ItemState[]>;
    heldInStage(harnessId: string, stageKey: string, at: Date): Promise<number>;
    lapsedLeases(at: Date, limit: number): Promise<readonly string[]>;
  };
  readonly write: {
    insert(item: ItemState, at: Date): Promise<void>;
    claim(claim: ItemClaim): Promise<boolean>;
    project(item: ItemState): Promise<void>;
  };
};
export type PagesGateway = {
  readonly read: { facts(pageIds: readonly string[]): Promise<readonly PageFacts[]> };
};
export type EventQuery = {
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly after: number;
  readonly limit: number;
};
export type EventPage = { readonly events: readonly HarnessEvent[]; readonly next: number | null };
export type HarnessEventsGateway = {
  readonly read: { page(query: EventQuery): Promise<EventPage> };
  readonly write: { append(events: readonly NewHarnessEvent[]): Promise<readonly HarnessEvent[]> };
};

export type DrizzleTransaction = {
  lock(key: string): Promise<void>;
  readonly harnesses: HarnessesGateway;
  readonly harnessStages: HarnessStagesGateway;
  readonly harnessItems: HarnessItemsGateway;
  readonly harnessEvents: HarnessEventsGateway;
  readonly pages: PagesGateway;
};
