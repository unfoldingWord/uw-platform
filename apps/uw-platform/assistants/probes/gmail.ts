import { emailSenderVerdict, type MailHeader } from '@uw/harness';
import {
  historyAnswer,
  mailSince,
  processedLabel,
  rawMail,
  replyHeaders,
  searchMail,
  sendRaw,
  type RawMail,
} from '../google/gmail.ts';
import { inboundMailOf } from '../google/mail-parse.ts';
import { replyMime, replySubject } from '../google/reply-mime.ts';
import { checked, failed, skipped, type ProbeResult } from './report.ts';
import { googleRig, type GoogleRig } from './google.ts';
import { notConfigured, WRITES_ONLY, type ProbeDeps } from './setup.ts';

const SETTINGS = [
  'GOOGLE_WORKSPACE_KEY',
  'GOOGLE_WORKSPACE_DOMAIN',
  'PROBE_PERSON_EMAIL',
  'PROBE_ASSISTANT_MAILBOX',
];
const READS = ['s8.3', 's8.2', 's8.1', 's8.5', 's8.6'];
const WRITES = ['s8.4', 's8.7'];
const LABEL_ID = /^[A-Za-z0-9_]{1,64}$/;
const SEND_TIMEOUT_MS = 5_000;
const SHOWN = 160;
const PROBE_TEXT = 'uw-platform staging probe: nothing to do, you can ignore this reply.';

type Mailbox = GoogleRig & { readonly mailbox: string };
type Found = { readonly mail: RawMail; readonly headers: readonly MailHeader[] };

async function listing(rig: Mailbox): Promise<ProbeResult[]> {
  const recent = await mailSince(rig.tokens, rig.mailbox, null);
  const listed = checked(
    's8.3',
    recent.ok,
    recent.ok
      ? `profile and inbox search answered, ${String(recent.value.messages.length)} unprocessed`
      : recent.failure,
  );
  const history = await historyAnswer(rig.tokens, rig.mailbox, '1');
  if (history.ok) {
    return [
      listed,
      skipped('s8.2', 'history id 1 still answers: a new mailbox; run again after a week'),
    ];
  }
  const expired = history.failure === 'not_found';
  return [listed, checked('s8.2', expired, `an old history id answers ${history.failure}`)];
}

async function newestFromPerson(rig: Mailbox): Promise<Found | string> {
  const listed = await searchMail(
    rig.tokens,
    rig.mailbox,
    `from:${rig.person} in:inbox newer_than:7d`,
  );
  if (!listed.ok) return `search ${listed.failure}`;
  const first = listed.value.messages[0];
  if (first === undefined)
    return `no mail from ${rig.person}: send a plain mail to ${rig.mailbox} first`;
  const raw = await rawMail(rig.tokens, rig.mailbox, first.id);
  if (!raw.ok) return `raw read ${raw.failure}`;
  const fetched = {
    id: raw.value.id,
    internalDate: raw.value.internalDate ?? new Date(0),
    raw: raw.value.raw,
  };
  const inbound = await inboundMailOf(fetched, async () => false);
  return { mail: raw.value, headers: inbound.headers };
}

function topResults(headers: readonly MailHeader[]): string {
  const top = headers.find((header) => header.name.toLowerCase() === 'authentication-results');
  return (top?.value ?? 'none').replace(/\s+/g, ' ').slice(0, SHOWN);
}

async function verdicts(rig: Mailbox, found: Found): Promise<ProbeResult[]> {
  const verdict = emailSenderVerdict({ headers: found.headers, fromAssistant: false }, rig.person);
  const dmarc = checked(
    's8.1',
    verdict === 'pass',
    `${verdict}; top Authentication-Results: ${topResults(found.headers)}`,
  );
  const dated = found.mail.internalDate !== null;
  const raw = checked('s8.5', dated, dated ? 'internalDate in milliseconds' : 'no internalDate');
  const reply = await replyHeaders(rig.tokens, rig.mailbox, found.mail.id);
  const threaded = reply !== null && reply.messageId !== null;
  const metadata = checked(
    's8.6',
    threaded,
    threaded ? 'Message-ID and thread read' : 'no Message-ID',
  );
  return [dmarc, raw, metadata];
}

async function writes(rig: Mailbox, found: Found | string): Promise<ProbeResult[]> {
  const label = await processedLabel(rig.tokens, rig.mailbox);
  const labelled = checked(
    's8.4',
    label.ok && LABEL_ID.test(label.value),
    label.ok ? `label ${label.value}` : label.failure,
  );
  if (typeof found === 'string') return [labelled, skipped('s8.7', found)];
  const headers = await replyHeaders(rig.tokens, rig.mailbox, found.mail.id);
  if (headers === null) return [labelled, failed('s8.7', 'no reply headers')];
  const raw = replyMime({
    from: rig.mailbox,
    to: rig.person,
    subject: replySubject(headers.subject),
    inReplyTo: headers.messageId,
    references: headers.references,
    text: PROBE_TEXT,
  });
  const sent = await sendRaw(rig.tokens, rig.mailbox, raw, headers.threadId, SEND_TIMEOUT_MS);
  return [labelled, checked('s8.7', sent.ok, sent.ok ? 'reply sent on the thread' : sent.failure)];
}

export async function gmailProbes(deps: ProbeDeps): Promise<ProbeResult[]> {
  const rig = googleRig(deps);
  if (typeof rig === 'string' || rig.mailbox === null) {
    const why = notConfigured(deps.env, SETTINGS);
    return [...READS, ...WRITES].map((id) => skipped(id, why));
  }
  const box: Mailbox = { ...rig, mailbox: rig.mailbox };
  const found = await newestFromPerson(box);
  const read =
    typeof found === 'string'
      ? ['s8.1', 's8.5', 's8.6'].map((id) => failed(id, found))
      : await verdicts(box, found);
  const all = [...(await listing(box)), ...read];
  if (!deps.write) return [...all, ...WRITES.map((id) => skipped(id, WRITES_ONLY))];
  return [...all, ...(await writes(box, found))];
}
