import { z } from 'zod';
import { googleCall, type GoogleAnswer, type GoogleCall } from './rest.ts';
import { GOOGLE_SCOPES, type TokenDeps } from './token.ts';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const PROCESSED_LABEL = 'uw/processed';
const mailScope = [GOOGLE_SCOPES.gmail];
const LIST_MOST = 25;
const RECENT_QUERY = `in:inbox -label:${PROCESSED_LABEL.replace('/', '-')} newer_than:2d`;

type GmailFailure = 'refused' | 'unavailable';
export type Gmail<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: GmailFailure };
export type Listed = { readonly id: string; readonly labelIds: readonly string[] };
export type MailPage = {
  readonly messages: readonly Listed[];
  readonly historyId: string;
  readonly expired: boolean;
  readonly more: boolean;
};
export type RawMail = {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds: readonly string[];
  readonly internalDate: Date | null;
  readonly raw: Uint8Array;
};
export type ReplyHeaders = {
  readonly threadId: string;
  readonly subject: string;
  readonly messageId: string | null;
  readonly references: string | null;
};

const historyId = z.string().regex(/^[0-9]{1,20}$/);
const listedSchema = z.object({ id: z.string(), labelIds: z.array(z.string()).default([]) });
const more = { nextPageToken: z.string().optional() };
const historySchema = z.object({
  ...more,
  historyId,
  history: z
    .array(z.object({ messagesAdded: z.array(z.object({ message: listedSchema })).default([]) }))
    .default([]),
});
const messagesSchema = z.object({ ...more, messages: z.array(listedSchema).default([]) });
const profileSchema = z.object({ historyId });
const rawSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  internalDate: z
    .string()
    .regex(/^[0-9]{1,16}$/)
    .optional(),
  raw: z.string(),
});
const labelsSchema = z.object({
  labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
});
const labelSchema = z.object({ id: z.string() });
const sentSchema = z.object({ id: z.string(), threadId: z.string() });
const metadataSchema = z.object({
  threadId: z.string(),
  payload: z.object({
    headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  }),
});

type MailCall = Omit<GoogleCall, 'subject' | 'scopes'>;

function call(tokens: TokenDeps, mailbox: string, request: MailCall) {
  return googleCall(tokens, { ...request, subject: mailbox, scopes: mailScope });
}

function get(tokens: TokenDeps, mailbox: string, url: string) {
  return call(tokens, mailbox, { method: 'GET', url });
}

function parsed<T>(answer: GoogleAnswer, schema: z.ZodType<T>): Gmail<T> {
  if (!answer.ok)
    return { ok: false, failure: answer.failure === 'unavailable' ? 'unavailable' : 'refused' };
  const value = schema.safeParse(answer.body);
  return value.success ? { ok: true, value: value.data } : { ok: false, failure: 'unavailable' };
}

function base64UrlToBytes(text: string): Uint8Array {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function searchMail(tokens: TokenDeps, mailbox: string, q: string) {
  const query = new URLSearchParams({ q, maxResults: String(LIST_MOST) });
  return parsed(await get(tokens, mailbox, `${GMAIL}/messages?${query}`), messagesSchema);
}

export function historyAnswer(tokens: TokenDeps, mailbox: string, since: string) {
  const query = new URLSearchParams({
    startHistoryId: since,
    historyTypes: 'messageAdded',
    labelId: 'INBOX',
    maxResults: String(LIST_MOST),
  });
  return get(tokens, mailbox, `${GMAIL}/history?${query}`);
}

async function recent(tokens: TokenDeps, mailbox: string): Promise<Gmail<MailPage>> {
  const profile = parsed(await get(tokens, mailbox, `${GMAIL}/profile`), profileSchema);
  if (!profile.ok) return profile;
  const listed = await searchMail(tokens, mailbox, RECENT_QUERY);
  if (!listed.ok) return listed;
  return {
    ok: true,
    value: {
      messages: listed.value.messages,
      historyId: profile.value.historyId,
      expired: true,
      more: listed.value.nextPageToken !== undefined,
    },
  };
}

export async function mailSince(
  tokens: TokenDeps,
  mailbox: string,
  since: string | null,
): Promise<Gmail<MailPage>> {
  if (since === null) return recent(tokens, mailbox);
  const answer = await historyAnswer(tokens, mailbox, since);
  if (!answer.ok && answer.failure === 'not_found') return recent(tokens, mailbox);
  const page = parsed(answer, historySchema);
  if (!page.ok) return page;
  const messages = page.value.history.flatMap((entry) =>
    entry.messagesAdded.map((added) => added.message),
  );
  const { historyId: next, nextPageToken } = page.value;
  const value = { messages, historyId: next, expired: false, more: nextPageToken !== undefined };
  return { ok: true, value };
}

export async function rawMail(
  tokens: TokenDeps,
  mailbox: string,
  id: string,
): Promise<Gmail<RawMail>> {
  const url = `${GMAIL}/messages/${encodeURIComponent(id)}?format=raw`;
  const got = parsed(await get(tokens, mailbox, url), rawSchema);
  if (!got.ok) return got;
  const { internalDate, raw, ...rest } = got.value;
  const at = internalDate === undefined ? null : new Date(Number(internalDate));
  return { ok: true, value: { ...rest, internalDate: at, raw: base64UrlToBytes(raw) } };
}

export async function processedLabel(tokens: TokenDeps, mailbox: string): Promise<Gmail<string>> {
  const labels = parsed(await get(tokens, mailbox, `${GMAIL}/labels`), labelsSchema);
  if (!labels.ok) return labels;
  const found = labels.value.labels.find((label) => label.name === PROCESSED_LABEL);
  if (found !== undefined) return { ok: true, value: found.id };
  const body = {
    name: PROCESSED_LABEL,
    labelListVisibility: 'labelHide',
    messageListVisibility: 'hide',
  };
  const made = parsed(
    await call(tokens, mailbox, { method: 'POST', url: `${GMAIL}/labels`, body }),
    labelSchema,
  );
  return made.ok ? { ok: true, value: made.value.id } : made;
}

export async function markProcessed(
  tokens: TokenDeps,
  mailbox: string,
  id: string,
  labelId: string,
): Promise<boolean> {
  const url = `${GMAIL}/messages/${encodeURIComponent(id)}/modify`;
  return (await call(tokens, mailbox, { method: 'POST', url, body: { addLabelIds: [labelId] } }))
    .ok;
}

export async function replyHeaders(
  tokens: TokenDeps,
  mailbox: string,
  id: string,
): Promise<ReplyHeaders | null> {
  const query = new URLSearchParams({ format: 'metadata' });
  for (const name of ['Subject', 'Message-ID', 'References']) query.append('metadataHeaders', name);
  const url = `${GMAIL}/messages/${encodeURIComponent(id)}?${query}`;
  const got = parsed(await get(tokens, mailbox, url), metadataSchema);
  if (!got.ok) return null;
  const header = (name: string) =>
    got.value.payload.headers.find((each) => each.name.toLowerCase() === name.toLowerCase())
      ?.value ?? null;
  return {
    threadId: got.value.threadId,
    subject: header('Subject') ?? '',
    messageId: header('Message-ID'),
    references: header('References'),
  };
}

export async function sendRaw(
  tokens: TokenDeps,
  mailbox: string,
  raw: Uint8Array,
  threadId: string | null,
  timeoutMs: number,
): Promise<Gmail<{ readonly id: string }> | { readonly ok: false; readonly failure: 'unknown' }> {
  const body =
    threadId === null ? { raw: bytesToBase64Url(raw) } : { raw: bytesToBase64Url(raw), threadId };
  const url = `${GMAIL}/messages/send`;
  const answer = await call(tokens, mailbox, { method: 'POST', url, body, timeoutMs });
  if (!answer.ok) {
    return { ok: false, failure: answer.failure === 'unavailable' ? 'unknown' : 'refused' };
  }
  const sent = sentSchema.safeParse(answer.body);
  return sent.success
    ? { ok: true, value: { id: sent.data.id } }
    : { ok: false, failure: 'unknown' };
}
