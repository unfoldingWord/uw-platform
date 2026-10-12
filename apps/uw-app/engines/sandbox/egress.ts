import { githubEgress, type GitHubEgress } from './github-egress.ts';

export const MCP_HOST = 'mcp.internal';
export const MODEL_HOST = 'model.internal';

export type McpHandler = (request: Request) => Promise<Response>;
type Fetcher = (request: Request) => Promise<Response>;

export type ModelRoute = {
  readonly host: string;
  readonly upstream: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly paths: readonly string[];
};

export type EgressRoutes = {
  readonly model: ModelRoute;
  readonly mcp: McpHandler;
  readonly github: GitHubEgress | null;
  readonly admit: () => Promise<boolean>;
  readonly refused: (host: string, path: string) => void;
};

const forwardedHeaders: readonly string[] = [
  'content-type',
  'accept',
  'anthropic-version',
  'anthropic-beta',
  'openai-beta',
  'user-agent',
];
const INFERENCE_METHOD = 'POST';

function refusal(routes: EgressRoutes, url: URL): Response {
  routes.refused(url.hostname, url.pathname);
  return new Response('egress refused', { status: 403 });
}

async function forwarded(request: Request, url: URL, route: ModelRoute): Promise<Request> {
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(route.headers)) headers.set(name, value);
  const target = `${route.upstream.replace(/\/$/, '')}${url.pathname}${url.search}`;
  const bytes = await request.arrayBuffer();
  return new Request(target, {
    method: INFERENCE_METHOD,
    headers,
    body: bytes,
    redirect: 'manual',
  });
}

function inference(request: Request, url: URL, route: ModelRoute): boolean {
  return request.method === INFERENCE_METHOD && route.paths.includes(url.pathname);
}

export async function egress(
  request: Request,
  routes: EgressRoutes,
  fetcher: Fetcher,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === MCP_HOST) return routes.mcp(request);
  const github = await githubEgress(request, routes, fetcher);
  if (github !== null) return github;
  if (url.hostname !== routes.model.host || !inference(request, url, routes.model)) {
    return refusal(routes, url);
  }
  if (!(await routes.admit())) return new Response('run halted', { status: 403 });
  return fetcher(await forwarded(request, url, routes.model));
}
