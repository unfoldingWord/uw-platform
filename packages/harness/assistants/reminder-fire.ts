import { assistantIdentityOf, identitySchema } from '@uw/contracts';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { AssistantReminderRow, DirectMessage, Ports, StoreTransaction } from '../ports.ts';
import { liveAssist } from './delegation.ts';
import { deliver, type Delivered } from './deliver.ts';
import { sendByFrom } from './settle.ts';

export type FireInput = { readonly limit: number };
export type Fired = { readonly fired: readonly string[]; readonly undelivered: readonly string[] };

type FirePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'directMessages'>;
type Claimed =
  | { readonly outcome: 'lapsed' }
  | {
      readonly outcome: 'claimed';
      readonly reminder: AssistantReminderRow;
      readonly message: DirectMessage | null;
    };

const FIRE_MOST = 200;
const REMINDER_PREFIX = 'Reminder: ';

async function undelivered(
  tx: StoreTransaction,
  context: RecordContext,
  reminder: AssistantReminderRow,
  from: 'set' | 'fired',
  why: Exclude<Delivered, 'sent'>,
): Promise<void> {
  const change = { id: reminder.id, from, to: 'undelivered' as const, at: context.at };
  if (!(await tx.assistantReminders.write.close(change))) return;
  await recordHarnessEvents(tx, context, reminder.harnessId, [
    draft('assistant_reminder_undelivered', { reminderId: reminder.id, why }),
  ]);
}

async function messageFor(
  tx: StoreTransaction,
  context: RecordContext,
  reminder: AssistantReminderRow,
): Promise<DirectMessage | null> {
  const request = await tx.assistantRequests.read.byId(reminder.requestId);
  if (request === null) return null;
  return {
    requestId: request.id,
    effectId: reminder.id,
    personId: reminder.personId,
    channel: request.channel,
    replyAddress: request.replyAddress,
    threadKey: request.threadKey,
    text: `${REMINDER_PREFIX}${reminder.text}`,
    traceId: context.traceId,
    sendBy: sendByFrom(context.at),
  };
}

async function claimIn(
  tx: StoreTransaction,
  ports: FirePorts,
  context: RecordContext,
  due: AssistantReminderRow,
): Promise<Claimed | null> {
  await tx.lock(lockKeys.assistantHarness(due.harnessId));
  const reminder = await tx.assistantReminders.read.byId(due.id);
  if (reminder === null || reminder.status !== 'set') return null;
  const harness = await tx.harnesses.read.byId(reminder.harnessId);
  const persona = identitySchema.parse(assistantIdentityOf(reminder.personId));
  const live = harness === null ? null : await liveAssist(tx, ports, context, harness, persona);
  if (live === null) {
    await undelivered(tx, context, reminder, 'set', 'delegation_lapsed');
    return { outcome: 'lapsed' };
  }
  await tx.assistantReminders.write.close({
    id: reminder.id,
    from: 'set',
    to: 'fired',
    at: context.at,
  });
  await recordHarnessEvents(tx, context, reminder.harnessId, [
    draft('assistant_reminder_fired', { reminderId: reminder.id }),
  ]);
  return { outcome: 'claimed', reminder, message: await messageFor(tx, context, reminder) };
}

async function fireOne(
  ports: FirePorts,
  caller: Caller,
  due: AssistantReminderRow,
): Promise<'fired' | 'undelivered' | null> {
  const context = recordContext(ports, caller, ports.clock.now());
  const claimed = await ports.store.transaction((tx) => claimIn(tx, ports, context, due));
  if (claimed === null) return null;
  if (claimed.outcome === 'lapsed') return 'undelivered';
  const { reminder, message } = claimed;
  const delivery: Delivered =
    message === null ? 'not_paired' : await deliver(ports.directMessages, message);
  if (delivery === 'sent') return 'fired';
  const closing = recordContext(ports, caller, ports.clock.now());
  await ports.store.transaction((tx) => undelivered(tx, closing, reminder, 'fired', delivery));
  return 'undelivered';
}

export async function fireDueReminders(
  ports: FirePorts,
  caller: Caller,
  input: FireInput,
): Promise<KernelOutcome<Fired>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > FIRE_MOST) {
    return refused('malformed_command', { why: 'limit_out_of_range' });
  }
  const now = ports.clock.now();
  const due = await ports.store.transaction((tx) =>
    tx.assistantReminders.read.due(now, input.limit),
  );
  const fired: string[] = [];
  const failed: string[] = [];
  for (const reminder of due) {
    const outcome = await fireOne(ports, caller, reminder);
    if (outcome === 'fired') fired.push(reminder.id);
    if (outcome === 'undelivered') failed.push(reminder.id);
  }
  return accepted({ fired, undelivered: failed });
}
