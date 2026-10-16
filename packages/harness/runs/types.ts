import type {
  ApproveAt,
  CapabilityWord,
  CostBasis,
  Engine,
  EventEvidence,
  Harness,
  Identity,
  ItemState,
  Principal,
  VerbName,
} from '@uw/contracts';
import type { RunRow } from '../ports.ts';

export type RunPersona = {
  readonly identity: Identity;
  readonly pageId: string;
  readonly engine: Engine;
  readonly model: string;
  readonly provider: string;
  readonly toolset: readonly VerbName[];
  readonly instructions: string;
  readonly approveAt: ApproveAt;
};

export type StartRunInput = {
  readonly itemId: string;
  readonly delegationId: string;
  readonly personaPageId: string;
};

export type StartedRun = {
  readonly runId: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly persona: Identity;
  readonly engine: Engine;
  readonly model: string;
  readonly leaseExpiresAt: string | null;
};

export type RunScene = {
  readonly run: RunRow;
  readonly principal: Principal;
  readonly harness: Harness;
  readonly item: ItemState;
  readonly persona: RunPersona;
  readonly capability: CapabilityWord;
};

export type RunStepInput = {
  readonly itemId: string;
  readonly runId: string;
  readonly step: EventEvidence['run_step_recorded']['step'];
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costBasis: CostBasis;
  readonly costMinor?: number | null;
  readonly computeMinor?: number | null;
  readonly model?: string | null;
  readonly resolvedProvider?: string | null;
  readonly toolsCalled?: readonly VerbName[];
  readonly writes?: number;
};
