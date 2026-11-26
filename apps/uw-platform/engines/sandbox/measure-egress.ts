import { siteOrigins } from '@uw/contracts';
import { publicHost, type Resolve } from './measure-address.ts';

export type MeasurePhase =
  | { readonly kind: 'closed' }
  | { readonly kind: 'install' }
  | { readonly kind: 'measure'; readonly origin: string };

export type MeasureRoute = {
  readonly phase: () => MeasurePhase;
  readonly resolve: Resolve;
  readonly refused: (host: string) => void;
};

type Fetcher = (request: Request) => Promise<Response>;

const reading: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const forwardedHeaders: readonly string[] = [
  'accept',
  'accept-language',
  'cache-control',
  'if-modified-since',
  'if-none-match',
  'range',
  'user-agent',
];
const packageIndex: ReadonlyMap<string, readonly string[]> = new Map([
  ['https://pypi.org', ['/simple/', '/pypi/']],
  ['https://files.pythonhosted.org', ['/packages/']],
]);

function refusal(route: MeasureRoute, url: URL): Response {
  route.refused(url.host);
  return new Response('egress refused', { status: 403 });
}

function upstream(request: Request, url: URL): Request {
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(url.href, { method: request.method, headers, redirect: 'manual' });
}

function packageRead(url: URL): boolean {
  const paths = packageIndex.get(url.origin) ?? [];
  return paths.some((path) => url.pathname.startsWith(path));
}

async function admitted(url: URL, phase: MeasurePhase, route: MeasureRoute): Promise<boolean> {
  if (phase.kind === 'install') return packageRead(url);
  if (phase.kind === 'closed' || !siteOrigins(phase.origin).includes(url.origin)) return false;
  return publicHost(url.hostname, route.resolve);
}

export async function measureEgress(
  request: Request,
  route: MeasureRoute,
  fetcher: Fetcher,
): Promise<Response> {
  const url = new URL(request.url);
  const allowed = reading.has(request.method) && (await admitted(url, route.phase(), route));
  return allowed ? fetcher(upstream(request, url)) : refusal(route, url);
}
