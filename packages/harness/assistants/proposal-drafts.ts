import {
  ASSISTANT_PROPOSAL_DAYS,
  identitySchema,
  proposalPayloadSchemaOf,
  type AssistantProposalKind,
  type Grant,
  type Principal,
} from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { AssistantProposalPayload, AssistantProposalRow, Ports } from '../ports.ts';
import { addressed, turnSceneOf, type TurnAddress, type TurnScene } from './reminder-turn.ts';

export type Proposed = { readonly proposalId: string; readonly status: 'pending' };
export type ProposeInput = TurnAddress & { readonly payload: unknown };

type ProposePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const PROPOSALS_PER_REQUEST_MOST = 5;
const PROPOSALS_PER_DAY_MOST = 20;
const INVITE_LONGEST_MS = 12 * HOUR_MS;
const INVITE_FURTHEST_MS = 548 * DAY_MS;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function inviteRefusal(payload: AssistantProposalPayload, now: Date): Refused | null {
  const start = new Date(String(payload['start'])).getTime();
  const end = new Date(String(payload['end'])).getTime();
  if (start < now.getTime()) return refused('malformed_command', { why: 'invite_in_past' });
  if (end <= start || end - start > INVITE_LONGEST_MS) {
    return refused('malformed_command', { why: 'invite_too_long' });
  }
  if (start > now.getTime() + INVITE_FURTHEST_MS) {
    return refused('malformed_command', { why: 'invite_too_far' });
  }
  return null;
}

function personPrincipal(personId: string, grants: readonly Grant[]): Principal {
  return {
    identity: identitySchema.parse(`human:${personId}`),
    kind: 'person',
    personId,
    email: null,
    grants: [...grants],
    interactive: false,
  };
}

async function pageRefusal(
  ports: ProposePorts,
  scene: TurnScene,
  pageId: string,
): Promise<Refused | null> {
  const { tx, context, request } = scene;
  const [page] = await tx.pages.read.facts([pageId]);
  if (page === undefined) return refused('malformed_command', { why: 'page_not_found', pageId });
  const grants = await ports.grants.resolveIn(tx, request.personId, context.at);
  const person = personPrincipal(request.personId, grants);
  if (!allowed(person, 'write', page, context.at)) {
    return refused('not_permitted', { why: 'page_not_editable', pageId });
  }
  return null;
}

async function capRefusal(
  scene: TurnScene,
  drafted: readonly AssistantProposalRow[],
): Promise<Refused | null> {
  const { tx, context, request } = scene;
  const capped = refused('not_permitted', { why: 'proposals_capped', requestId: request.id });
  if (drafted.length >= PROPOSALS_PER_REQUEST_MOST) return capped;
  const since = new Date(context.at.getTime() - DAY_MS);
  const today = await tx.assistantProposals.read.countSince(request.harnessId, since);
  return today >= PROPOSALS_PER_DAY_MOST ? capped : null;
}

type Wanted = { readonly kind: AssistantProposalKind; readonly payload: AssistantProposalPayload };

async function proposedIn(
  ports: ProposePorts,
  scene: TurnScene,
  wanted: Wanted,
): Promise<KernelOutcome<Proposed>> {
  const { tx, context, request } = scene;
  const drafted = await tx.assistantProposals.read.forRequest(request.id);
  const same = drafted.find(
    (row) => row.kind === wanted.kind && canonical(row.payload) === canonical(wanted.payload),
  );
  if (same !== undefined) return accepted({ proposalId: same.id, status: 'pending' });
  const capped = await capRefusal(scene, drafted);
  if (capped !== null) return capped;
  const pageId = wanted.payload['pageId'];
  if (wanted.kind === 'page_append' && typeof pageId === 'string') {
    const unfit = await pageRefusal(ports, scene, pageId);
    if (unfit !== null) return unfit;
  }
  const row = await tx.assistantProposals.write.insert({
    id: context.ids.next(),
    harnessId: request.harnessId,
    personId: request.personId,
    requestId: request.id,
    kind: wanted.kind,
    payload: wanted.payload,
    expiresAt: new Date(context.at.getTime() + ASSISTANT_PROPOSAL_DAYS * DAY_MS),
    createdAt: context.at,
  });
  await recordHarnessEvents(tx, context, request.harnessId, [
    draft('assistant_proposal_drafted', {
      proposalId: row.id,
      requestId: request.id,
      kind: row.kind,
    }),
  ]);
  return accepted({ proposalId: row.id, status: 'pending' });
}

export async function propose(
  ports: ProposePorts,
  caller: Caller,
  kind: AssistantProposalKind,
  input: ProposeInput,
): Promise<KernelOutcome<Proposed>> {
  const parsed = proposalPayloadSchemaOf(kind).safeParse(input.payload);
  if (!parsed.success || !addressed(input)) {
    return refused('malformed_command', { why: 'proposal_input', kind });
  }
  const payload: AssistantProposalPayload = { ...parsed.data };
  const context = recordContext(ports, caller, ports.clock.now());
  const outside = kind === 'invite' ? inviteRefusal(payload, context.at) : null;
  if (outside !== null) return outside;
  return ports.store.transaction(async (tx) => {
    const scene = await turnSceneOf(tx, ports, context, caller, input);
    return 'status' in scene ? scene : proposedIn(ports, scene, { kind, payload });
  });
}
