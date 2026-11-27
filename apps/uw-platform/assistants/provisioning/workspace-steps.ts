import { assistantAddressOf } from '@uw/contracts';
import type { DirectoryAnswer, DirectoryUser } from '../google/directory.ts';
import {
  mailboxOf,
  personMailOf,
  putMailbox,
  removeMailbox,
  type MailboxRow,
} from '../google/subjects.ts';
import type { AccountWork } from './rows.ts';
import {
  done,
  failed,
  type ProvisionerDeps,
  type StepOutcome,
  type WorkspaceSide,
} from './types.ts';

type Failure = Extract<DirectoryAnswer<unknown>, { ok: false }>['failure'];

const failureOf = {
  refused: failed('workspace_refused'),
  unavailable: failed('workspace_unavailable'),
  not_wired: failed('workspace_not_wired'),
  conflict: failed('name_taken'),
} as const satisfies Record<Failure, StepOutcome>;

const FAMILY_NAME = 'Assistant';

function givenNameOf(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function keyOf(mailbox: MailboxRow): string {
  return mailbox.googleUserId ?? mailbox.address;
}

async function stored(
  deps: ProvisionerDeps,
  work: AccountWork,
  user: DirectoryUser,
  status: 'active' | 'suspended',
): Promise<StepOutcome> {
  await putMailbox(deps.db, {
    harnessId: work.harnessId,
    personId: work.personId,
    address: user.address,
    googleUserId: user.id,
    status,
    at: deps.clock.now(),
  });
  return done;
}

async function adopted(
  side: WorkspaceSide,
  work: AccountWork,
  address: string,
): Promise<DirectoryAnswer<DirectoryUser>> {
  const found = await side.directory.user(address);
  if (!found.ok) return found;
  if (found.value?.harnessId !== work.harnessId) return { ok: false, failure: 'conflict' };
  if (!found.value.suspended) return { ok: true, value: found.value };
  const restored = await side.directory.setSuspended(found.value.id, false);
  return restored.ok ? { ok: true, value: { ...found.value, suspended: false } } : restored;
}

async function created(deps: ProvisionerDeps, side: WorkspaceSide, work: AccountWork) {
  const address = assistantAddressOf(work.name, side.domain);
  const made = await side.directory.insert({
    address,
    givenName: givenNameOf(work.name),
    familyName: FAMILY_NAME,
    orgUnitPath: side.unit,
    harnessId: work.harnessId,
  });
  const user = !made.ok && made.failure === 'conflict' ? await adopted(side, work, address) : made;
  return user.ok ? stored(deps, work, user.value, 'active') : failureOf[user.failure];
}

async function forgotten(deps: ProvisionerDeps, side: WorkspaceSide, mailbox: MailboxRow) {
  const removed = await side.directory.remove(keyOf(mailbox));
  if (!removed.ok) return failureOf[removed.failure];
  await removeMailbox(deps.db, mailbox.harnessId);
  return done;
}

async function ownMailBound(deps: ProvisionerDeps, side: WorkspaceSide, work: AccountWork) {
  const address = await personMailOf(deps.db, work.personId, side.domain);
  if (address === null) return;
  await deps.kernel.assistants.bindAddress(deps.caller, {
    personId: work.personId,
    channel: 'email',
    address,
  });
}

export async function workspaceUser(
  deps: ProvisionerDeps,
  work: AccountWork,
): Promise<StepOutcome> {
  const side = deps.workspace;
  if (side === null) return failed('workspace_not_wired');
  const outcome = await userOf(deps, side, work);
  if (outcome.kind === 'done') await ownMailBound(deps, side, work);
  return outcome;
}

async function userOf(
  deps: ProvisionerDeps,
  side: WorkspaceSide,
  work: AccountWork,
): Promise<StepOutcome> {
  const address = assistantAddressOf(work.name, side.domain);
  const mailbox = await mailboxOf(deps.db, work.harnessId);
  if (mailbox !== null && mailbox.address !== address) {
    const gone = await forgotten(deps, side, mailbox);
    if (gone.kind !== 'done') return gone;
    return created(deps, side, work);
  }
  if (mailbox === null || mailbox.status === 'deleted') return created(deps, side, work);
  if (mailbox.status === 'active') return done;
  const restored = await side.directory.setSuspended(keyOf(mailbox), false);
  if (!restored.ok) return failureOf[restored.failure];
  await putMailbox(deps.db, { ...mailbox, status: 'active', at: deps.clock.now() });
  return done;
}

export async function suspendUser(deps: ProvisionerDeps, work: AccountWork): Promise<StepOutcome> {
  const mailbox = await mailboxOf(deps.db, work.harnessId);
  if (mailbox === null || mailbox.status !== 'active') return done;
  const side = deps.workspace;
  if (side === null) return failed('workspace_not_wired');
  const suspended = await side.directory.setSuspended(keyOf(mailbox), true);
  if (!suspended.ok) return failureOf[suspended.failure];
  await putMailbox(deps.db, { ...mailbox, status: 'suspended', at: deps.clock.now() });
  return done;
}

export async function deleteUser(deps: ProvisionerDeps, work: AccountWork): Promise<StepOutcome> {
  const mailbox = await mailboxOf(deps.db, work.harnessId);
  if (mailbox === null) return done;
  const side = deps.workspace;
  if (side === null) return failed('workspace_not_wired');
  return forgotten(deps, side, mailbox);
}
