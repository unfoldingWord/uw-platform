import type { Harness, IntakeVia, IssueRef, Principal } from '@uw/contracts';
import { allowed, isAgent, isIngestPrincipal, isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { lockKeys } from '../lock-keys.ts';
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

async function recordedToday(
  tx: StoreTransaction,
  at: Date,
  harnessId: string,
  subject: NotReadySubject,
): Promise<boolean> {
  const scope =
    subject.issue === null
      ? { evidencePage: subject.pageId ?? '' }
      : { evidenceIssue: subject.issue.githubId };
  await tx.lock(
    subject.issue === null
      ? lockKeys.harnessEvents(harnessId)
      : lockKeys.githubIssue(subject.issue.githubId),
  );
  const found = await tx.harnessEvents.read.recent({
    since: new Date(at.getTime() - DAY_MS),
    names: ['done_when_missing'],
    agentsOnly: false,
    limit: 1,
    harnessIds: [harnessId],
    ...scope,
  });
  return found.length > 0;
}

export async function recordNotReadyIn(
  tx: StoreTransaction,
  context: RecordContext,
  harnessId: string,
  subject: NotReadySubject,
): Promise<boolean> {
  if (await recordedToday(tx, context.at, harnessId, subject)) return false;
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
