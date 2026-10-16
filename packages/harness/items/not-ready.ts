import {
  eventEvidenceSchemas,
  type Harness,
  type HarnessEvent,
  type IntakeVia,
  type IssueRef,
  type Principal,
} from '@uw/contracts';
import { allowed, isAgent, isIngestPrincipal, isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from './record.ts';

type NotReadyPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type NotReadySubject = {
  readonly via: IntakeVia;
  readonly issue: IssueRef | null;
  readonly pageId: string | null;
  readonly title: string;
};
export type NotReadyInput = NotReadySubject & { readonly harnessId: string };

const DAY_MS = 86_400_000;
const RECENT_LIMIT = 500;
const TITLE_LIMIT = 200;

export async function intakeWriter(
  ports: Pick<Ports, 'grants'>,
  tx: StoreTransaction,
  actor: Principal,
  harness: Harness,
  at: Date,
): Promise<boolean> {
  if (isIngestPrincipal(actor) || isSystemPrincipal(actor)) return true;
  if (isAgent(actor) || actor.personId === null) return false;
  const grants = await ports.grants.resolveIn(tx, actor.personId, at);
  return allowed({ ...actor, grants: [...grants] }, 'write', harness, at);
}

function titled(subject: NotReadySubject): string {
  const trimmed = subject.title.trim().slice(0, TITLE_LIMIT);
  if (trimmed !== '') return trimmed;
  return subject.issue === null ? 'Untitled page' : `${subject.issue.repo}#${subject.issue.number}`;
}

function sameSubject(event: HarnessEvent, subject: NotReadySubject): boolean {
  const parsed = eventEvidenceSchemas.done_when_missing.safeParse(event.evidence);
  if (!parsed.success) return false;
  if (subject.issue !== null) return parsed.data.issue?.githubId === subject.issue.githubId;
  return parsed.data.pageId === subject.pageId;
}

export async function recordNotReadyIn(
  tx: StoreTransaction,
  context: RecordContext,
  harnessId: string,
  subject: NotReadySubject,
): Promise<boolean> {
  const recent = await tx.harnessEvents.read.recent({
    since: new Date(context.at.getTime() - DAY_MS),
    names: ['done_when_missing'],
    agentsOnly: false,
    limit: RECENT_LIMIT,
    harnessIds: [harnessId],
  });
  if (recent.some((event) => sameSubject(event, subject))) return false;
  const evidence = {
    via: subject.via,
    issue: subject.issue,
    pageId: subject.pageId,
    title: titled(subject),
  };
  await recordHarnessEvents(tx, context, harnessId, [draft('done_when_missing', evidence)]);
  return true;
}

export function notReadyRefusal(subject: NotReadySubject): Refused {
  if (subject.issue === null) return refused('done_when_missing', { pageId: subject.pageId });
  return refused('done_when_missing', { issue: subject.issue.number });
}

export async function recordNotReady(
  ports: NotReadyPorts,
  caller: Caller,
  input: NotReadyInput,
): Promise<Refused> {
  const { harnessId, ...subject } = input;
  if ((subject.issue === null) === (subject.pageId === null)) {
    return refused('malformed_command', { field: 'subject' });
  }
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const harness = await tx.harnesses.read.byId(harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId });
    if (!(await intakeWriter(ports, tx, caller.actor, harness, at))) {
      return refused('not_permitted', { harnessId });
    }
    await recordNotReadyIn(tx, recordContext(ports, caller, at), harness.id, subject);
    return notReadyRefusal(subject);
  });
}
