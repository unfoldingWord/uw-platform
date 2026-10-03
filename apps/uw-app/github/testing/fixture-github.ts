export type FixtureReply = {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
};

type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly authorization: string | null;
  readonly accept: string | null;
  readonly body: unknown;
};

export type FixtureGitHub = {
  readonly fetch: typeof fetch;
  on(method: string, path: string, reply: FixtureReply | FixtureReply[]): void;
  requests(): readonly RecordedRequest[];
};

const tokenRoute = /^POST \/app\/installations\/[0-9]+\/access_tokens$/;
const notFound: FixtureReply = { status: 404, body: { message: 'Not Found' } };

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  return new URL(typeof input === 'string' ? input : input.url);
}

function bodyOf(init: RequestInit | undefined): unknown {
  const raw = init?.body;
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function responseOf(reply: FixtureReply): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  for (const [name, value] of Object.entries(reply.headers ?? {})) headers.set(name, value);
  const text =
    reply.body === undefined
      ? null
      : typeof reply.body === 'string'
        ? reply.body
        : JSON.stringify(reply.body);
  return new Response(text, { status: reply.status, headers });
}

export function fixtureGitHub(): FixtureGitHub {
  const routes = new Map<string, FixtureReply[]>();
  const recorded: RecordedRequest[] = [];
  let minted = 0;

  const next = (key: string): FixtureReply => {
    const queue = routes.get(key);
    if (queue && queue.length > 0) {
      return (queue.length > 1 ? queue.shift() : queue[0]) ?? notFound;
    }
    if (!tokenRoute.test(key)) return notFound;
    minted += 1;
    return {
      status: 201,
      body: { token: `ghs_fixture_${minted}`, expires_at: '2099-01-01T00:00:00Z' },
    };
  };

  const send = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    recorded.push({
      method,
      path: url.pathname,
      search: url.search,
      authorization: new Headers(init?.headers).get('authorization'),
      accept: new Headers(init?.headers).get('accept'),
      body: bodyOf(init),
    });
    return Promise.resolve(responseOf(next(`${method} ${url.pathname}`)));
  };

  return {
    fetch: send,
    on(method, path, reply) {
      routes.set(`${method.toUpperCase()} ${path}`, Array.isArray(reply) ? [...reply] : [reply]);
    },
    requests: () => [...recorded],
  };
}
