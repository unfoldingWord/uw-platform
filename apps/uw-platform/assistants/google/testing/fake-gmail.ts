type Reply = { readonly status: number; readonly body: unknown };
type Issued = { readonly subject: string; readonly scopes: readonly string[] };

type StoredMail = {
  readonly id: string;
  readonly threadId: string;
  readonly history: number;
  readonly labelIds: string[];
  readonly internalDate: string;
  readonly raw: string;
};
type Mailbox = {
  readonly messages: StoredMail[];
  readonly labels: Map<string, string>;
  readonly sent: SentMail[];
  oldestHistory: number;
};
type SentMail = {
  readonly id: string;
  readonly raw: string;
  readonly threadId: string | null;
};

export type FakeGmail = {
  deliver(mailbox: string, raw: string, threadId?: string): string;
  sent(mailbox: string): readonly SentMail[];
  labelsOf(mailbox: string, id: string): readonly string[];
  expireHistory(mailbox: string): void;
  route(method: string, url: URL, issued: Issued, body: unknown): Reply | null;
};

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const PREFIX = '/gmail/v1/users/me/';

function error(status: number, message: string): Reply {
  return { status, body: { error: { code: status, message } } };
}

function base64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function headersOf(raw: string): { name: string; value: string }[] {
  const head = raw.replaceAll('\r\n', '\n').split('\n\n')[0] ?? '';
  return head
    .replace(/\n[ \t]+/g, ' ')
    .split('\n')
    .flatMap((line) => {
      const colon = line.indexOf(':');
      return colon <= 0
        ? []
        : [{ name: line.slice(0, colon), value: line.slice(colon + 1).trim() }];
    });
}

type State = { readonly boxes: Map<string, Mailbox>; next: number };

function boxOf(state: State, address: string): Mailbox {
  const found = state.boxes.get(address);
  if (found !== undefined) return found;
  const made: Mailbox = { messages: [], labels: new Map(), sent: [], oldestHistory: 0 };
  state.boxes.set(address, made);
  return made;
}

function listed(mail: StoredMail) {
  return { id: mail.id, threadId: mail.threadId, labelIds: [...mail.labelIds] };
}

function history(state: State, box: Mailbox, query: URLSearchParams): Reply {
  const start = Number(query.get('startHistoryId') ?? '0');
  if (start < box.oldestHistory) return error(404, 'Requested entity was not found.');
  const label = query.get('labelId');
  const added = box.messages
    .filter((mail) => mail.history > start)
    .filter((mail) => label === null || mail.labelIds.includes(label))
    .map((mail) => ({ id: String(mail.history), messagesAdded: [{ message: listed(mail) }] }));
  return { status: 200, body: { history: added, historyId: String(state.next) } };
}

function search(box: Mailbox, query: URLSearchParams): Reply {
  const processed = box.labels.get('uw/processed');
  const most = Number(query.get('maxResults') ?? '100');
  const messages = box.messages
    .filter((mail) => mail.labelIds.includes('INBOX'))
    .filter((mail) => processed === undefined || !mail.labelIds.includes(processed))
    .slice(0, most)
    .map((mail) => ({ id: mail.id, threadId: mail.threadId }));
  return { status: 200, body: messages.length === 0 ? { resultSizeEstimate: 0 } : { messages } };
}

function oneMessage(box: Mailbox, id: string, query: URLSearchParams): Reply {
  const mail = box.messages.find((each) => each.id === id);
  if (mail === undefined) return error(404, 'Requested entity was not found.');
  const head = { id: mail.id, threadId: mail.threadId, labelIds: [...mail.labelIds] };
  if (query.get('format') === 'raw') {
    return { status: 200, body: { ...head, internalDate: mail.internalDate, raw: mail.raw } };
  }
  const wanted = new Set(query.getAll('metadataHeaders').map((name) => name.toLowerCase()));
  const headers = headersOf(fromBase64Url(mail.raw)).filter((h) =>
    wanted.has(h.name.toLowerCase()),
  );
  return { status: 200, body: { ...head, payload: { headers } } };
}

function modify(box: Mailbox, id: string, body: unknown): Reply {
  const mail = box.messages.find((each) => each.id === id);
  if (mail === undefined) return error(404, 'Requested entity was not found.');
  const add = (body as { addLabelIds?: string[] }).addLabelIds ?? [];
  if (add.some((label) => ![...box.labels.values()].includes(label))) {
    return error(400, 'Invalid label');
  }
  for (const label of add) if (!mail.labelIds.includes(label)) mail.labelIds.push(label);
  return { status: 200, body: listed(mail) };
}

function labels(state: State, box: Mailbox, method: string, body: unknown): Reply {
  if (method === 'GET') {
    const all = [...box.labels].map(([name, id]) => ({ id, name, type: 'user' }));
    return {
      status: 200,
      body: { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, ...all] },
    };
  }
  const name = (body as { name?: string }).name ?? '';
  if (box.labels.has(name)) return error(409, 'Label name exists or conflicts');
  state.next += 1;
  const id = `Label_${String(state.next)}`;
  box.labels.set(name, id);
  return { status: 200, body: { id, name } };
}

function send(state: State, box: Mailbox, body: unknown): Reply {
  const { raw, threadId } = body as { raw?: string; threadId?: string };
  if (raw === undefined) return error(400, "'raw' RFC822 payload message string is required");
  state.next += 1;
  const id = `sent${String(state.next).padStart(12, '0')}`;
  box.sent.push({ id, raw: fromBase64Url(raw), threadId: threadId ?? null });
  return { status: 200, body: { id, threadId: threadId ?? id, labelIds: ['SENT'] } };
}

type Route = (state: State, box: Mailbox, request: GmailRequest) => Reply;
type GmailRequest = {
  readonly method: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
};

const routes: ReadonlyMap<string, Route> = new Map([
  [
    'GET profile',
    (state, box) => ({
      status: 200,
      body: { historyId: String(state.next), messagesTotal: box.messages.length },
    }),
  ],
  ['GET history', (state, box, request) => history(state, box, request.query)],
  ['GET messages', (_state, box, request) => search(box, request.query)],
  ['POST messages/send', (state, box, request) => send(state, box, request.body)],
  ['GET labels', (state, box, request) => labels(state, box, 'GET', request.body)],
  ['POST labels', (state, box, request) => labels(state, box, 'POST', request.body)],
]);

function messageRoute(box: Mailbox, path: string, request: GmailRequest): Reply {
  const one = /^messages\/([^/]+)(\/modify)?$/.exec(path);
  if (one === null) return error(404, 'Not Found');
  const id = decodeURIComponent(one[1] ?? '');
  if (one[2] !== undefined) {
    return request.method === 'POST' ? modify(box, id, request.body) : error(404, 'Not Found');
  }
  return request.method === 'GET' ? oneMessage(box, id, request.query) : error(404, 'Not Found');
}

function routeIn(state: State, method: string, url: URL, box: Mailbox, body: unknown): Reply {
  const path = url.pathname.slice(PREFIX.length);
  const request = { method, query: url.searchParams, body };
  const route = routes.get(`${method} ${path}`);
  return route === undefined ? messageRoute(box, path, request) : route(state, box, request);
}

export function createFakeGmail(): FakeGmail {
  const state: State = { boxes: new Map(), next: 1000 };
  return {
    deliver: (mailbox, raw, threadId) => {
      state.next += 1;
      const id = `msg${String(state.next).padStart(13, '0')}`;
      boxOf(state, mailbox).messages.push({
        id,
        threadId: threadId ?? id,
        history: state.next,
        labelIds: ['INBOX', 'UNREAD'],
        internalDate: String(Date.UTC(2026, 10, 27, 9, 0, 0)),
        raw: base64Url(raw),
      });
      return id;
    },
    sent: (mailbox) => [...boxOf(state, mailbox).sent],
    labelsOf: (mailbox, id) =>
      boxOf(state, mailbox).messages.find((m) => m.id === id)?.labelIds ?? [],
    expireHistory: (mailbox) => {
      boxOf(state, mailbox).oldestHistory = state.next + 1;
    },
    route: (method, url, issued, body) => {
      if (!url.pathname.startsWith(PREFIX)) return null;
      if (!issued.scopes.includes(GMAIL_SCOPE)) return error(403, 'Insufficient Permission');
      return routeIn(state, method, url, boxOf(state, issued.subject), body);
    },
  };
}
