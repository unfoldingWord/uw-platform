export const FAKE_ZULIP_SITE = 'https://chat.example.org';
export const FAKE_ADMIN = { email: 'platform-admin@example.org', apiKey: 'admin-key-0001' };

type FakeUser = {
  readonly user_id: number;
  readonly email: string;
  readonly full_name: string;
  is_active: boolean;
  readonly is_bot: boolean;
};

type FakeBot = FakeUser & {
  readonly api_key: string;
  readonly short_name: string;
  readonly services: readonly { base_url: string; interface: number; token: string }[];
};

type FakeMessage = {
  readonly id: number;
  readonly sender: string;
  readonly type: string;
  readonly to: readonly number[];
  readonly content: string;
};

type Failure = { readonly status: number; readonly headers?: Record<string, string> };

type Reply = { readonly status: number; readonly body: unknown; readonly headers?: Headers };

export type FakeZulip = {
  readonly fetch: typeof fetch;
  addUser(email: string, fullName: string, id?: number): number;
  messages(): readonly FakeMessage[];
  bots(): readonly FakeBot[];
  calls(): readonly string[];
  failNext(failure: Failure): void;
  hangNext(): void;
};

type State = {
  next: number;
  readonly users: Map<string, FakeUser>;
  readonly bots: Map<number, FakeBot>;
  readonly messages: FakeMessage[];
  readonly calls: string[];
  readonly failures: Failure[];
  hang: boolean;
};

const realm = 'chat.example.org';

function ok(body: Record<string, unknown>): Reply {
  return { status: 200, body: { result: 'success', msg: '', ...body } };
}

function error(status: number, msg: string, code = 'BAD_REQUEST'): Reply {
  return { status, body: { result: 'error', msg, code } };
}

function credentialsOf(request: Request): { email: string; key: string } | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return null;
  const [email, key] = atob(header.slice('Basic '.length)).split(':');
  return email !== undefined && key !== undefined ? { email, key } : null;
}

function isAdmin(request: Request): boolean {
  const given = credentialsOf(request);
  return given?.email === FAKE_ADMIN.email && given.key === FAKE_ADMIN.apiKey;
}

function botSending(state: State, request: Request): FakeBot | null {
  const given = credentialsOf(request);
  for (const bot of state.bots.values()) {
    if (bot.email === given?.email && bot.api_key === given.key && bot.is_active) return bot;
  }
  return null;
}

function jsonText(value: string | null): unknown {
  try {
    return value === null ? null : (JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function createBot(state: State, form: URLSearchParams): Reply {
  const shortName = form.get('short_name') ?? '';
  const fullName = form.get('full_name') ?? '';
  const payloadUrl = jsonText(form.get('payload_url'));
  if (form.get('bot_type') !== '3' || typeof payloadUrl !== 'string') {
    return error(400, 'Invalid bot type or payload url');
  }
  const email = `${shortName}-bot@${realm}`;
  if (state.users.has(email)) return error(400, 'Username already in use');
  state.next += 1;
  const bot: FakeBot = {
    user_id: state.next,
    email,
    full_name: fullName,
    short_name: shortName,
    is_active: true,
    is_bot: true,
    api_key: `bot-key-${String(state.next)}`,
    services: [{ base_url: payloadUrl, interface: 1, token: `token-${String(state.next)}` }],
  };
  state.bots.set(bot.user_id, bot);
  state.users.set(email, bot);
  return ok({ user_id: bot.user_id, api_key: bot.api_key, avatar_url: '' });
}

function listBots(state: State): Reply {
  return ok({
    bots: [...state.bots.values()].map((bot) => ({
      user_id: bot.user_id,
      username: bot.email,
      email: bot.email,
      full_name: bot.full_name,
      api_key: bot.api_key,
      is_active: bot.is_active,
      bot_type: 3,
      services: bot.services,
    })),
  });
}

function userByEmail(state: State, email: string): Reply {
  const user = state.users.get(decodeURIComponent(email));
  if (user === undefined) return error(400, 'No such user');
  return ok({
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      is_active: user.is_active,
      is_bot: user.is_bot,
    },
  });
}

function setActive(state: State, id: string, active: boolean): Reply {
  const user = [...state.users.values()].find((each) => String(each.user_id) === id);
  if (user === undefined) return error(400, 'No such user');
  if (user.is_active === active)
    return error(400, active ? 'User is already active' : 'User is already deactivated');
  user.is_active = active;
  return ok({});
}

function sendMessage(state: State, request: Request, form: URLSearchParams): Reply {
  const bot = botSending(state, request);
  if (bot === null) return error(401, 'Invalid API key', 'UNAUTHORIZED');
  const to = jsonText(form.get('to'));
  if (form.get('type') !== 'direct' || !Array.isArray(to))
    return error(400, 'Invalid message type');
  const recipients = to.filter((value): value is number => typeof value === 'number');
  const known = recipients.every((id) => [...state.users.values()].some((u) => u.user_id === id));
  if (!known) return error(400, 'Invalid user ID');
  state.next += 1;
  state.messages.push({
    id: state.next,
    sender: bot.email,
    type: 'direct',
    to: recipients,
    content: form.get('content') ?? '',
  });
  return ok({ id: state.next });
}

type AdminRoute = {
  readonly method: string;
  readonly path: RegExp;
  answer(state: State, match: string, form: URLSearchParams): Reply;
};

const adminRoutes: readonly AdminRoute[] = [
  {
    method: 'POST',
    path: /^\/api\/v1\/bots$/,
    answer: (state, _m, form) => createBot(state, form),
  },
  { method: 'GET', path: /^\/api\/v1\/bots$/, answer: (state) => listBots(state) },
  {
    method: 'GET',
    path: /^\/api\/v1\/users\/([^/]+)$/,
    answer: (state, m) => userByEmail(state, m),
  },
  {
    method: 'DELETE',
    path: /^\/api\/v1\/users\/([0-9]+)$/,
    answer: (state, m) => setActive(state, m, false),
  },
  {
    method: 'POST',
    path: /^\/api\/v1\/users\/([0-9]+)\/reactivate$/,
    answer: (state, m) => setActive(state, m, true),
  },
];

function adminRoute(state: State, method: string, path: string, form: URLSearchParams): Reply {
  for (const route of adminRoutes) {
    const match = route.method === method ? route.path.exec(path) : null;
    if (match !== null) return route.answer(state, match[1] ?? '', form);
  }
  return error(404, 'Not found', 'NOT_FOUND');
}

async function route(state: State, request: Request): Promise<Reply> {
  const url = new URL(request.url);
  const form = new URLSearchParams(request.method === 'GET' ? '' : await request.text());
  state.calls.push(`${request.method} ${url.pathname}`);
  const failure = state.failures.shift();
  if (failure !== undefined) {
    return {
      status: failure.status,
      body: error(failure.status, 'failed').body,
      headers: new Headers(failure.headers),
    };
  }
  if (url.origin !== FAKE_ZULIP_SITE) return error(404, 'Not found', 'NOT_FOUND');
  if (request.method === 'POST' && url.pathname === '/api/v1/messages') {
    return sendMessage(state, request, form);
  }
  if (!isAdmin(request)) return error(401, 'Invalid API key', 'UNAUTHORIZED');
  return adminRoute(state, request.method, url.pathname, form);
}

function hung(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
}

export function fakeZulip(): FakeZulip {
  const state: State = {
    next: 1000,
    users: new Map(),
    bots: new Map(),
    messages: [],
    calls: [],
    failures: [],
    hang: false,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (state.hang) {
      state.hang = false;
      state.calls.push(`${request.method} ${new URL(request.url).pathname}`);
      return hung(init?.signal);
    }
    const reply = await route(state, request);
    const headers = new Headers(reply.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
  };
  return {
    fetch: fetcher,
    addUser: (email, fullName, id) => {
      state.next += 1;
      const userId = id ?? state.next;
      state.users.set(email, {
        user_id: userId,
        email,
        full_name: fullName,
        is_active: true,
        is_bot: false,
      });
      return userId;
    },
    messages: () => state.messages.map((message) => ({ ...message })),
    bots: () => [...state.bots.values()],
    calls: () => [...state.calls],
    failNext: (failure) => {
      state.failures.push(failure);
    },
    hangNext: () => {
      state.hang = true;
    },
  };
}
