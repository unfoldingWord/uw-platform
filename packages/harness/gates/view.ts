import {
  eventEvidenceSchemas,
  gateViewSchema,
  type GateView,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type Stage,
} from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { readAllEvents } from '../items/record.ts';
import { resolveExit } from '../items/transitions.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import { FactsUnavailableError } from '../port-errors.ts';
import type { Ports, PullRequestFacts, StoreTransaction } from '../ports.ts';
import { itemScene } from '../reads/scene.ts';
import { effectOf, shipPreview } from './approve-at-ship.ts';

type ViewPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'store'>;

type Seen = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stage: Stage;
  readonly atConnectorExit: boolean;
  readonly recorded: GateView['recorded'];
};

const CLOSES_SHOWN = 50;

function recordedOf(events: readonly HarnessEvent[]): GateView['recorded'] {
  const last = events.findLast((event) => event.name === 'risk_derived');
  if (last === undefined) return null;
  const evidence = eventEvidenceSchemas.risk_derived.parse(last.evidence);
  return {
    riskTier: evidence.riskTier,
    riskDomains: evidence.riskDomains,
    floorDomains: evidence.floorDomains,
    head: evidence.head,
    declaration: evidence.declaration,
    refusal: evidence.refusal,
  };
}

function connectorExit(item: ItemState, stages: readonly Stage[], stage: Stage): boolean {
  if (effectOf(stage.connector) === null || item.gateStatus !== 'parked') return false;
  if (item.gateTarget === null) return true;
  return resolveExit(stages, stage, item.gateTarget)?.kind === 'forward';
}

async function seenIn(
  ports: ViewPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly itemId: string; readonly at: Date },
): Promise<KernelOutcome<Seen>> {
  const scene = await itemScene(ports, tx, caller, input.itemId, input.at);
  if (scene.status !== 'accepted') return scene;
  if (isAgent(caller.actor)) return refused('not_permitted', { actor: caller.actor.identity });
  const { item, harness, stage } = scene.value;
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const events = await readAllEvents(tx, harness.id, item.itemId);
  const atConnectorExit = connectorExit(item, stages, stage);
  return accepted({ item, harness, stage, atConnectorExit, recorded: recordedOf(events) });
}

async function readModelFacts(ports: ViewPorts, item: ItemState): Promise<PullRequestFacts | null> {
  if (item.pullRequest === null) return null;
  try {
    return await ports.githubFacts.pullRequest(item.pullRequest);
  } catch (error) {
    if (error instanceof FactsUnavailableError) return null;
    throw error;
  }
}

function factsShown(facts: PullRequestFacts | null): GateView['facts'] {
  if (facts === null) return null;
  const { declaration } = facts;
  return {
    head: facts.head,
    state: facts.state,
    draft: facts.draft,
    baseRef: facts.baseRef,
    freshAt: facts.freshAt.toISOString(),
    declaration:
      declaration !== null && declaration.closes.length <= CLOSES_SHOWN ? declaration : null,
  };
}

function viewOf(caller: Caller, seen: Seen, facts: PullRequestFacts | null, at: Date): GateView {
  const { item, harness, stage } = seen;
  const source = { facts, item, harness, approver: caller.actor, at, override: false };
  return gateViewSchema.parse({
    itemId: item.itemId,
    harnessId: harness.id,
    stageKey: stage.key,
    gateStatus: item.gateStatus,
    connector: stage.connector,
    expectedHead: item.expectedHead,
    pullRequest: item.pullRequest,
    recorded: seen.recorded,
    facts: factsShown(facts),
    ship: seen.atConnectorExit ? shipPreview(source) : null,
  });
}

export async function gateView(
  ports: ViewPorts,
  caller: Caller,
  input: { readonly itemId: string },
  options?: { readonly at: Date },
): Promise<KernelOutcome<GateView>> {
  const at = options?.at ?? ports.clock.now();
  const seen = await ports.store.transaction((tx) =>
    seenIn(ports, tx, caller, { itemId: input.itemId, at }),
  );
  if (seen.status !== 'accepted') return seen;
  const facts = await readModelFacts(ports, seen.value.item);
  return accepted(viewOf(caller, seen.value, facts, at));
}
