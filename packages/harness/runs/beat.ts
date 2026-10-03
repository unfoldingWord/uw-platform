import type { Principal } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { readAllEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';
import { pollQueue } from '../reads/poll.ts';
import { backingOff, reviewedAtHead } from './backoff.ts';
import { personaPageOf } from './persona.ts';
import { startRun } from './start.ts';
import type { StartedRun } from './types.ts';

type BeatPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store' | 'runs'>;

export type BeatInput = { readonly limit: number };
export type Beaten = {
  readonly started: readonly StartedRun[];
  readonly skipped: readonly { readonly delegationId: string; readonly reason: string }[];
};

type Planned = {
  readonly delegation: Delegation;
  readonly pageId: string;
  readonly itemId: string;
};

const BEAT_LIMIT = 50;
const POLL_LIMIT = 50;

function seedOf(delegation: Delegation): Principal {
  return {
    identity: delegation.persona,
    kind: 'agent',
    personId: delegation.personId,
    email: null,
    grants: [],
    interactive: false,
  };
}

async function workflowPage(tx: StoreTransaction, delegation: Delegation): Promise<string | null> {
  const facts = await tx.pages.read.activePersona(delegation.persona, delegation.harnessId);
  const page = personaPageOf(facts ?? undefined);
  return page?.frontmatter.run_shape === 'workflow-run' ? page.facts.id : null;
}

async function runsAlready(tx: StoreTransaction, delegation: Delegation): Promise<boolean> {
  const live = await tx.harnessRuns.read.live(delegation.harnessId);
  return live.some((run) => run.persona === delegation.persona);
}

async function firstItem(
  ports: BeatPorts,
  tx: StoreTransaction,
  delegation: Delegation,
  at: Date,
): Promise<string | null> {
  const input = { harnessId: delegation.harnessId, limit: POLL_LIMIT };
  const polled = await pollQueue(ports, tx, seedOf(delegation), input, at);
  if (polled.status !== 'accepted') return null;
  for (const item of polled.value) {
    const events = await readAllEvents(tx, item.harnessId, item.itemId);
    const { persona } = delegation;
    if (!backingOff(events, persona, at) && !reviewedAtHead(events, persona)) return item.itemId;
  }
  return null;
}

async function planOne(
  ports: BeatPorts,
  tx: StoreTransaction,
  delegation: Delegation,
  at: Date,
): Promise<Planned | null> {
  const pageId = await workflowPage(tx, delegation);
  if (pageId === null || (await runsAlready(tx, delegation))) return null;
  const itemId = await firstItem(ports, tx, delegation, at);
  return itemId === null ? null : { delegation, pageId, itemId };
}

async function planIn(ports: BeatPorts, tx: StoreTransaction, at: Date): Promise<Planned[]> {
  const filter = { personId: null, persona: null, harnessId: null };
  const live = await tx.delegations.read.live(filter, at);
  const working = live
    .filter((delegation) => delegation.capability !== 'none')
    .sort((a, b) => a.id.localeCompare(b.id));
  const plans: Planned[] = [];
  for (const delegation of working) {
    const plan = await planOne(ports, tx, delegation, at);
    if (plan !== null) plans.push(plan);
  }
  return plans;
}

export async function beat(
  ports: BeatPorts,
  caller: Caller,
  input: BeatInput,
): Promise<KernelOutcome<Beaten>> {
  const { limit } = input;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > BEAT_LIMIT) {
    return refused('malformed_command', { why: 'limit' });
  }
  const at = ports.clock.now();
  const plans = await ports.store.transaction((tx) => planIn(ports, tx, at));
  const started: StartedRun[] = [];
  const skipped: { delegationId: string; reason: string }[] = [];
  const busy = new Set<string>();
  for (const { delegation, pageId, itemId } of plans) {
    const key = `${delegation.persona} ${delegation.harnessId}`;
    if (started.length >= limit || busy.has(key)) continue;
    const seed: Caller = { actor: seedOf(delegation), traceId: caller.traceId, requestId: null };
    const input = { itemId, delegationId: delegation.id, personaPageId: pageId };
    const outcome = await startRun(ports, seed, input, { solo: true });
    if (outcome.status !== 'accepted') {
      skipped.push({ delegationId: delegation.id, reason: outcome.reason });
      continue;
    }
    started.push(outcome.value);
    busy.add(key);
  }
  return accepted({ started, skipped });
}
