type RecordedRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};

export type FakeFetch = {
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly requests: RecordedRequest[];
  respondNext(status: number, body: unknown): void;
};

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function bodyOf(init: RequestInit | undefined): unknown {
  const raw = init?.body;
  if (typeof raw !== 'string') return null;
  return JSON.parse(raw);
}

export function fakeFetch(): FakeFetch {
  const replies: { readonly status: number; readonly body: unknown }[] = [];
  const requests: RecordedRequest[] = [];
  return {
    requests,
    respondNext: (status, body) => {
      replies.push({ status, body });
    },
    fetch: async (input, init) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const method = init?.method ?? 'GET';
      requests.push({ url: urlOf(input), method, headers, body: bodyOf(init) });
      const reply = replies.shift();
      if (reply === undefined) throw new Error('no reply scripted for the fake fetch');
      const headersOut = { 'content-type': 'application/json' };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: headersOut,
      });
    },
  };
}
