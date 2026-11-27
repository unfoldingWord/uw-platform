import { decodeJwt, jwtVerify, type CryptoKey } from 'jose';

export const FAKE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export type FakeEvent = {
  id: string;
  status: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  organizer: { email: string; self?: boolean };
  attendees?: { email: string }[];
  visibility?: string;
  transparency?: string;
  extendedProperties?: { private?: Record<string, string> };
};

type FakeRequest = {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly subject: string | null;
  readonly body: unknown;
};

type Reply = { readonly status: number; readonly body: unknown };
type Issued = { readonly subject: string; readonly scopes: readonly string[] };
type State = {
  publicKey: CryptoKey | null;
  readonly granted: Set<string>;
  readonly users: Map<string, FakeEvent[]>;
  readonly tokens: Map<string, Issued>;
  readonly requests: FakeRequest[];
  readonly failures: Reply[];
  next: number;
};

export type FakeGoogle = {
  readonly fetch: typeof fetch;
  trust(publicKey: CryptoKey): void;
  addUser(email: string): void;
  addEvent(email: string, event: Omit<FakeEvent, 'id' | 'status' | 'organizer'>): string;
  events(email: string): readonly FakeEvent[];
  requests(): readonly FakeRequest[];
  revokeScope(scope: string): void;
  failNext(status: number): void;
};

const SCOPE_ROOT = 'https://www.googleapis.com/auth/';
const EVENTS_SCOPE = `${SCOPE_ROOT}calendar.events`;
const FREEBUSY_SCOPE = `${SCOPE_ROOT}calendar.freebusy`;

function error(status: number, message: string): Reply {
  return { status, body: { error: { code: status, message } } };
}

const invalidGrant: Reply = { status: 400, body: { error: 'invalid_grant' } };

async function verified(state: State, signed: string): Promise<Issued | null> {
  if (state.publicKey === null) return null;
  const claimed = decodeJwt(signed);
  const issuedAt = claimed.iat ?? 0;
  if ((claimed.exp ?? 0) - issuedAt > 3600) return null;
  const { payload } = await jwtVerify(signed, state.publicKey, {
    audience: FAKE_TOKEN_URL,
    currentDate: new Date(issuedAt * 1000),
  });
  return { subject: String(payload.sub), scopes: String(payload['scope']).split(' ') };
}

function issue(state: State, issued: Issued): Reply {
  if (!issued.scopes.every((scope) => state.granted.has(scope))) {
    return { status: 401, body: { error: 'unauthorized_client' } };
  }
  if (!state.users.has(issued.subject)) return invalidGrant;
  state.next += 1;
  const accessToken = `ya29.fake-${String(state.next)}`;
  state.tokens.set(accessToken, issued);
  return {
    status: 200,
    body: { access_token: accessToken, expires_in: 3599, token_type: 'Bearer' },
  };
}

async function token(state: State, form: URLSearchParams): Promise<Reply> {
  if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }
  try {
    const issued = await verified(state, form.get('assertion') ?? '');
    return issued === null ? invalidGrant : issue(state, issued);
  } catch {
    return invalidGrant;
  }
}

function issuedTo(state: State, request: Request): Issued | null {
  const header = request.headers.get('authorization') ?? '';
  return state.tokens.get(header.replace(/^Bearer /, '')) ?? null;
}

function overlaps(event: FakeEvent, from: string, to: string): boolean {
  const start = event.start.dateTime ?? `${event.start.date ?? ''}T00:00:00Z`;
  const end = event.end.dateTime ?? `${event.end.date ?? ''}T00:00:00Z`;
  return Date.parse(start) < Date.parse(to) && Date.parse(end) > Date.parse(from);
}

function list(calendar: FakeEvent[], query: URLSearchParams): Reply {
  const from = query.get('timeMin') ?? '';
  const to = query.get('timeMax') ?? '';
  const most = Number(query.get('maxResults') ?? '250');
  const items = calendar
    .filter((event) => event.status !== 'cancelled' && overlaps(event, from, to))
    .sort((a, b) => Date.parse(a.start.dateTime ?? '') - Date.parse(b.start.dateTime ?? ''));
  const page = items.slice(0, most);
  const more = items.length > most ? { nextPageToken: 'more' } : {};
  return { status: 200, body: { kind: 'calendar#events', items: page, ...more } };
}

function insert(
  calendar: FakeEvent[],
  owner: string,
  query: URLSearchParams,
  body: unknown,
): Reply {
  const event = body as FakeEvent;
  if (query.get('sendUpdates') === null) return error(400, 'sendUpdates expected by this fake');
  if (calendar.some((each) => each.id === event.id)) {
    return error(409, 'The requested identifier already exists.');
  }
  const stored: FakeEvent = {
    ...event,
    status: 'confirmed',
    organizer: { email: owner, self: true },
  };
  calendar.push(stored);
  return { status: 200, body: stored };
}

function oneEvent(calendar: FakeEvent[], method: string, id: string): Reply {
  const found = calendar.find((event) => event.id === id);
  if (found === undefined) return error(404, 'Not Found');
  if (found.status === 'cancelled') return error(410, 'Resource has been deleted');
  if (method === 'GET') return { status: 200, body: found };
  found.status = 'cancelled';
  return { status: 204, body: null };
}

function freeBusy(state: State, body: unknown): Reply {
  const asked = body as { timeMin: string; timeMax: string; items: { id: string }[] };
  const calendars = new Map<string, unknown>();
  for (const { id } of asked.items) {
    const events = state.users.get(id);
    calendars.set(
      id,
      events === undefined
        ? { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] }
        : {
            busy: events
              .filter((event) => event.status !== 'cancelled')
              .filter((event) => overlaps(event, asked.timeMin, asked.timeMax))
              .map((event) => ({ start: event.start.dateTime, end: event.end.dateTime })),
          },
    );
  }
  return {
    status: 200,
    body: { kind: 'calendar#freeBusy', calendars: Object.fromEntries(calendars) },
  };
}

const EVENTS_PATH = '/calendar/v3/calendars/primary/events';

function collectionRoute(
  request: Request,
  url: URL,
  issued: Issued,
  calendar: FakeEvent[],
  body: unknown,
): Reply {
  if (request.method === 'GET') return list(calendar, url.searchParams);
  if (request.method === 'POST') return insert(calendar, issued.subject, url.searchParams, body);
  return error(404, 'Not Found');
}

function eventsRoute(
  state: State,
  request: Request,
  url: URL,
  issued: Issued,
  body: unknown,
): Reply {
  if (!issued.scopes.includes(EVENTS_SCOPE)) return error(403, 'Insufficient Permission');
  const calendar = state.users.get(issued.subject) ?? [];
  if (url.pathname === EVENTS_PATH) return collectionRoute(request, url, issued, calendar, body);
  const one = /^\/calendar\/v3\/calendars\/primary\/events\/([^/]+)$/.exec(url.pathname);
  const method = request.method;
  if (one === null || (method !== 'GET' && method !== 'DELETE')) return error(404, 'Not Found');
  return oneEvent(calendar, method, decodeURIComponent(one[1] ?? ''));
}

function calendarRoute(state: State, request: Request, url: URL, body: unknown): Reply {
  const issued = issuedTo(state, request);
  if (issued === null) return error(401, 'Invalid Credentials');
  if (url.pathname !== '/calendar/v3/freeBusy')
    return eventsRoute(state, request, url, issued, body);
  if (request.method !== 'POST') return error(404, 'Not Found');
  return issued.scopes.includes(FREEBUSY_SCOPE)
    ? freeBusy(state, body)
    : error(403, 'Insufficient Permission');
}

async function bodyOf(request: Request): Promise<{ form: URLSearchParams; json: unknown }> {
  const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
  const json = (() => {
    try {
      return text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      return null;
    }
  })();
  return { form: new URLSearchParams(text), json };
}

async function route(state: State, request: Request): Promise<Reply> {
  const url = new URL(request.url);
  const { form, json } = await bodyOf(request);
  state.requests.push({
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    subject: issuedTo(state, request)?.subject ?? null,
    body: url.href === FAKE_TOKEN_URL ? Object.fromEntries(form) : json,
  });
  const failure = state.failures.shift();
  if (failure !== undefined) return failure;
  if (url.href === FAKE_TOKEN_URL && request.method === 'POST') return token(state, form);
  if (url.origin === 'https://www.googleapis.com') return calendarRoute(state, request, url, json);
  return error(404, 'Not Found');
}

export function fakeGoogle(): FakeGoogle {
  const state: State = {
    publicKey: null,
    granted: new Set([
      `${SCOPE_ROOT}gmail.modify`,
      EVENTS_SCOPE,
      FREEBUSY_SCOPE,
      `${SCOPE_ROOT}admin.directory.user`,
    ]),
    users: new Map(),
    tokens: new Map(),
    requests: [],
    failures: [],
    next: 0,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const reply = await route(state, new Request(input, init));
    const body = reply.status === 204 ? null : JSON.stringify(reply.body);
    return new Response(body, {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    fetch: fetcher,
    trust: (publicKey) => {
      state.publicKey = publicKey;
    },
    addUser: (email) => {
      if (!state.users.has(email)) state.users.set(email, []);
    },
    addEvent: (email, event) => {
      state.next += 1;
      const id = `seeded${String(state.next)}`;
      const calendar = state.users.get(email) ?? [];
      calendar.push({ ...event, id, status: 'confirmed', organizer: { email, self: true } });
      state.users.set(email, calendar);
      return id;
    },
    events: (email) =>
      (state.users.get(email) ?? []).filter((event) => event.status !== 'cancelled'),
    requests: () => [...state.requests],
    revokeScope: (scope) => {
      state.granted.delete(scope);
    },
    failNext: (status) => {
      state.failures.push(error(status, 'failed'));
    },
  };
}
