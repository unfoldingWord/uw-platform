export const REGISTRY_HOST = 'registry.internal';

const UPSTREAM = 'https://registry.npmjs.org';
const reading: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const forwardedHeaders: readonly string[] = ['accept', 'user-agent'];

export type RegistryRoute = { readonly open: () => boolean };

type Routed = {
  readonly registry: RegistryRoute | null;
  readonly refused: (host: string, path: string) => void;
};

function upstream(request: Request, url: URL): Request {
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(`${UPSTREAM}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    redirect: 'manual',
  });
}

export async function registryEgress(
  request: Request,
  route: Routed,
  fetcher: (request: Request) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.hostname !== REGISTRY_HOST) return null;
  const open = route.registry !== null && route.registry.open();
  if (!open || !reading.has(request.method) || url.protocol !== 'http:' || url.port !== '') {
    route.refused(url.hostname, url.pathname);
    return new Response('egress refused', { status: 403 });
  }
  return fetcher(upstream(request, url));
}
