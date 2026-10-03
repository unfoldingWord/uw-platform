export const MCP_HOST = 'mcp.internal';
export const MODEL_HOST = 'model.internal';

export type McpHandler = (request: Request) => Promise<Response>;
type Fetcher = (request: Request) => Promise<Response>;

export type ModelRoute = {
  readonly host: string;
  readonly upstream: string;
  readonly headers: Readonly<Record<string, string>>;
};

export type EgressRoutes = {
  readonly model: ModelRoute;
  readonly mcp: McpHandler;
  readonly refused: (host: string) => void;
};

const droppedHeaders = ['authorization', 'x-api-key', 'cf-aig-authorization', 'cookie'];

async function forwarded(request: Request, url: URL, route: ModelRoute): Promise<Request> {
  const headers = new Headers(request.headers);
  for (const name of droppedHeaders) headers.delete(name);
  for (const [name, value] of Object.entries(route.headers)) headers.set(name, value);
  const target = `${route.upstream.replace(/\/$/, '')}${url.pathname}${url.search}`;
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : request.body;
  const bytes = body === null ? null : await request.arrayBuffer();
  return new Request(target, { method: request.method, headers, body: bytes, redirect: 'manual' });
}

export async function egress(
  request: Request,
  routes: EgressRoutes,
  fetcher: Fetcher,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === MCP_HOST) return routes.mcp(request);
  if (url.hostname === routes.model.host) {
    return fetcher(await forwarded(request, url, routes.model));
  }
  routes.refused(url.hostname);
  return new Response('egress refused', { status: 403 });
}
