import type { AssistantMailRefusal, UntrustedPart } from '@uw/contracts';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { splitForward } from './mail-split.ts';
import { emailSenderVerdict, type MailHeader } from './mail-verdict.ts';
import { recordRequest, type RecordedRequest } from './requests.ts';

export type MailAttachment = { readonly filename: string; readonly text: string };
export type InboundMail = {
  readonly externalId: string;
  readonly threadKey: string | null;
  readonly receivedAt: string;
  readonly headers: readonly MailHeader[];
  readonly text: string;
  readonly attachments: readonly MailAttachment[];
  readonly fromAssistant: boolean;
};
export type AdmitMailInput = {
  readonly personId: string;
  readonly mail: InboundMail;
  readonly instructions: 'on' | 'off';
};

type MailPorts = Pick<Ports, 'clock' | 'ids' | 'store'>;
type Screened =
  | { readonly admitted: true; readonly owner: string }
  | { readonly admitted: false; readonly why: AssistantMailRefusal }
  | { readonly admitted: false; readonly why: 'no_assistant' };

const NOTE_MOST = 20_000;
const PART_MOST = 50_000;
const PARTS_MOST = 20;
const PARTS_TOTAL_MOST = 100_000;

function partsOf(forwarded: readonly string[], attachments: readonly MailAttachment[]) {
  const wanted: UntrustedPart[] = [
    ...forwarded.map((text) => ({ source: 'email_forwarded' as const, text })),
    ...attachments.map((each) => ({
      source: 'email_attachment' as const,
      text: `${each.filename}\n\n${each.text}`,
    })),
  ];
  const kept: UntrustedPart[] = [];
  let left = PARTS_TOTAL_MOST;
  for (const part of wanted.slice(0, PARTS_MOST)) {
    const text = part.text.slice(0, Math.min(PART_MOST, left));
    if (text.trim() === '') continue;
    kept.push({ source: part.source, text });
    left -= text.length;
  }
  return kept;
}

async function screenIn(
  ports: MailPorts,
  caller: Caller,
  tx: StoreTransaction,
  input: AdmitMailInput,
): Promise<Screened> {
  const harness = await tx.harnesses.read.byPerson(input.personId);
  if (harness === null) return { admitted: false, why: 'no_assistant' };
  const binding = await tx.assistantBindings.read.of(harness.id, 'email');
  const verdict =
    binding === null ? 'email_not_bound' : emailSenderVerdict(input.mail, binding.address);
  const why =
    verdict === 'pass' && input.instructions === 'off' ? 'email_instructions_off' : verdict;
  if (why === 'pass' && binding !== null) return { admitted: true, owner: binding.address };
  if (why === 'pass') return { admitted: false, why: 'email_not_bound' };
  await recordHarnessEvents(tx, recordContext(ports, caller, ports.clock.now()), harness.id, [
    draft('assistant_mail_declined', { why }),
  ]);
  return { admitted: false, why };
}

export async function admitMail(
  ports: MailPorts,
  caller: Caller,
  input: AdmitMailInput,
): Promise<KernelOutcome<RecordedRequest>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const screened = await ports.store.transaction((tx) => screenIn(ports, caller, tx, input));
  if (!screened.admitted) {
    return screened.why === 'no_assistant'
      ? refused('no_assistant', { personId: input.personId })
      : refused('not_permitted', { why: screened.why });
  }
  const { mail } = input;
  const split = splitForward(mail.text);
  return recordRequest(ports, caller, {
    personId: input.personId,
    channel: 'email',
    externalId: mail.externalId,
    threadKey: mail.threadKey,
    replyAddress: screened.owner,
    receivedAt: mail.receivedAt,
    note: split.note.slice(0, NOTE_MOST),
    untrustedParts: partsOf(split.forwarded, mail.attachments),
  });
}
