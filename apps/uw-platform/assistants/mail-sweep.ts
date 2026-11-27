import type { Executor } from '@uw/db/client';
import type { Caller, Kernel } from '@uw/harness';
import {
  mailSince,
  markProcessed,
  processedLabel,
  rawMail,
  type Listed,
  type MailPage,
} from './google/gmail.ts';
import { inboundMailOf } from './google/mail-parse.ts';
import {
  isAssistantMailbox,
  mailboxesToSweep,
  saveCursor,
  type SweptMailbox,
} from './google/mailboxes.ts';
import type { TokenDeps } from './google/token.ts';
import type { TurnStarter } from './turn/start.ts';

export type MailSweepDeps = {
  readonly db: Executor;
  readonly kernel: Kernel;
  readonly caller: Caller;
  readonly tokens: TokenDeps;
  readonly startTurn: TurnStarter;
  readonly now: () => Date;
  readonly instructions: 'on' | 'off';
};
export type MailSweepLimits = {
  readonly mailboxes: number;
  readonly messages: number;
  readonly budgetMs: number;
};
export type MailSwept = {
  mailboxes: number;
  admitted: number;
  declined: number;
  started: number;
  failed: number;
};

type Handled = 'admitted' | 'started' | 'declined' | 'skipped' | 'failed';
type Pass = { readonly deps: MailSweepDeps; readonly stopAt: number; readonly swept: MailSwept };
type Box = SweptMailbox & { readonly labelId: string };

const SENT = 'SENT';

function count(swept: MailSwept, handled: Handled): void {
  if (handled === 'started') {
    swept.admitted += 1;
    swept.started += 1;
  } else if (handled === 'admitted') swept.admitted += 1;
  else if (handled === 'declined') swept.declined += 1;
  else if (handled === 'failed') swept.failed += 1;
}

async function admitted(pass: Pass, box: Box, raw: Listed & { raw: Uint8Array }, at: Date) {
  const { deps } = pass;
  const mail = await inboundMailOf({ id: raw.id, internalDate: at, raw: raw.raw }, (address) =>
    isAssistantMailbox(deps.db, address),
  );
  const outcome = await deps.kernel.assistants.admitMail(deps.caller, {
    personId: box.personId,
    mail,
    instructions: deps.instructions,
  });
  if (outcome.status !== 'accepted') return 'declined';
  if (!outcome.value.created) return 'admitted';
  try {
    const { requestId } = outcome.value;
    const started = await deps.startTurn({ requestId, traceId: deps.caller.traceId });
    return started === 'started' ? 'started' : 'admitted';
  } catch {
    return 'admitted';
  }
}

async function handleOne(pass: Pass, box: Box, listed: Listed): Promise<Handled> {
  const { tokens, now } = pass.deps;
  const got = await rawMail(tokens, box.address, listed.id);
  if (!got.ok) return 'failed';
  if (got.value.labelIds.includes(box.labelId) || got.value.labelIds.includes(SENT)) {
    return 'skipped';
  }
  const at = got.value.internalDate ?? now();
  const handled = await admitted(pass, box, { ...listed, raw: got.value.raw }, at);
  const marked = await markProcessed(tokens, box.address, listed.id, box.labelId);
  return marked ? handled : 'failed';
}

function pendingOf(page: MailPage, labelId: string): readonly Listed[] {
  const seen = new Set<string>();
  return page.messages.filter((listed) => {
    if (seen.has(listed.id)) return false;
    seen.add(listed.id);
    return !listed.labelIds.includes(labelId) && !listed.labelIds.includes(SENT);
  });
}

async function drained(pass: Pass, box: Box, page: MailPage, most: number): Promise<boolean> {
  const pending = pendingOf(page, box.labelId);
  for (const listed of pending.slice(0, most)) {
    if (pass.deps.now().getTime() >= pass.stopAt) return false;
    const handled = await handleOne(pass, box, listed);
    count(pass.swept, handled);
    if (handled === 'failed') return false;
  }
  return pending.length <= most && !page.more;
}

async function labelOf(pass: Pass, mailbox: SweptMailbox): Promise<string | null> {
  if (mailbox.labelId !== null) return mailbox.labelId;
  const label = await processedLabel(pass.deps.tokens, mailbox.address);
  return label.ok ? label.value : null;
}

async function sweepOne(pass: Pass, mailbox: SweptMailbox, most: number): Promise<void> {
  const { deps } = pass;
  const labelId = await labelOf(pass, mailbox);
  const page =
    labelId === null ? null : await mailSince(deps.tokens, mailbox.address, mailbox.historyId);
  if (labelId === null || page === null || !page.ok) {
    pass.swept.failed += 1;
    await saveCursor(deps.db, mailbox.harnessId, { ...mailbox, sweptAt: deps.now() });
    return;
  }
  const box = { ...mailbox, labelId };
  const done = await drained(pass, box, page.value, most);
  const keep = page.value.expired ? null : mailbox.historyId;
  const historyId = done ? page.value.historyId : keep;
  await saveCursor(deps.db, mailbox.harnessId, { historyId, labelId, sweptAt: deps.now() });
}

export async function sweepMail(deps: MailSweepDeps, limits: MailSweepLimits): Promise<MailSwept> {
  const swept: MailSwept = { mailboxes: 0, admitted: 0, declined: 0, started: 0, failed: 0 };
  const pass: Pass = { deps, stopAt: deps.now().getTime() + limits.budgetMs, swept };
  for (const mailbox of await mailboxesToSweep(deps.db, limits.mailboxes)) {
    if (deps.now().getTime() >= pass.stopAt) break;
    swept.mailboxes += 1;
    await sweepOne(pass, mailbox, limits.messages);
  }
  return swept;
}
