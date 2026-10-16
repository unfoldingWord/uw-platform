import type { Harness, ItemState, PullRequestDeclaration, Stage } from '@uw/contracts';
import { factsFailure } from '../gates/facts-failure.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports, PullRequestRef, StoreTransaction } from '../ports.ts';
import { fixOffered } from './fix-offer.ts';
import { draft, readAllEvents, type EventDraft } from './record.ts';

type FixPorts = Pick<Ports, 'githubFacts' | 'store'>;

type FixStart = { readonly declared: PullRequestDeclaration | null };
export type FixRead = FixStart | { readonly refusal: Refused } | null;

type Target = { readonly ref: PullRequestRef | null };
type FixScene = { readonly harness: Harness; readonly stage: Stage };
type Fixing = { readonly delegationId: string | null; readonly fix: FixRead };
type Claiming = { readonly drafts: readonly EventDraft[] };

const notFixing: Claiming = { drafts: [] };

async function fixTarget(
  ports: FixPorts,
  itemId: string,
  delegationId: string | null,
): Promise<Target | null> {
  if (delegationId === null) return null;
  return ports.store.transaction(async (tx) => {
    const delegation = await tx.delegations.read.byId(delegationId);
    if (delegation?.capability !== 'fix') return null;
    const item = await tx.harnessItems.read.byId(itemId);
    return { ref: item?.pullRequest ?? null };
  });
}

export async function readFixStart(
  ports: FixPorts,
  itemId: string,
  delegationId: string | null,
): Promise<FixRead> {
  const target = await fixTarget(ports, itemId, delegationId);
  if (target === null) return null;
  if (target.ref === null) return { declared: null };
  try {
    const facts = await ports.githubFacts.pullRequest(target.ref);
    if (facts === null) {
      return { refusal: refused('not_permitted', { why: 'pull_request_unknown' }) };
    }
    return { declared: facts.declaration };
  } catch (error) {
    return { refusal: factsFailure(error) };
  }
}

function notOffered(scene: FixScene): Refused {
  const why = scene.harness.fixClaim ? 'no_review_round' : 'fix_claim_off';
  return refused('pickup_not_allowed', { stage: scene.stage.key, capability: 'fix', why });
}

export async function fixClaiming(
  tx: StoreTransaction,
  scene: FixScene,
  item: ItemState,
  fixing: Fixing,
): Promise<Claiming | Refused> {
  const { delegationId, fix } = fixing;
  if (delegationId === null) return notFixing;
  const delegation = await tx.delegations.read.byId(delegationId);
  if (delegation?.capability !== 'fix') return notFixing;
  const head = item.expectedHead;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  if (head === null || !fixOffered(scene.harness, item, events) || fix === null) {
    return notOffered(scene);
  }
  if ('refusal' in fix) return fix.refusal;
  return { drafts: [draft('fix_claimed', { delegationId, head, declaration: fix.declared })] };
}
