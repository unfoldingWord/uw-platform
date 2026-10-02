import { Hono, type Context } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AppDeps, AppEnv } from '../deps.ts';
import { commitOf } from '../env.ts';
import { refuse } from '../http/outcomes.ts';
import { platformKernel } from '../kernel.ts';
import { requestLogger } from '../request-logger.ts';
import { jsonRpcError, MAX_BODY_BYTES, singleMessage } from './body.ts';
import { withAgentPrincipal } from './mint.ts';
import { createVerbServer } from './server.ts';

async function serve(c: Context<AppEnv>, deps: Pick<AppDeps, 'clock'>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const principal = c.get('principal');
  if (principal === null) return refuse(c, 'unauthenticated');
  const body = await singleMessage(c.req.raw);
  if (!body.ok) {
    c.set('outcome', 'malformed_command');
    return jsonRpcError(body);
  }
  const server = createVerbServer({
    principal,
    host: 'external',
    at: c.get('now'),
    traceId: c.get('traceId'),
    kernel: platformKernel(database, deps.clock),
    db: database.db,
    commit: commitOf(c.env),
    logger: requestLogger(c),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw, { parsedBody: body.message });
    c.set('outcome', response.ok ? 'accepted' : `http_${response.status}`);
    return response;
  } finally {
    await server.close();
  }
}

function postOnly(c: Context<AppEnv>): Response {
  c.set('outcome', 'not_wired');
  c.header('Allow', 'POST');
  return c.json({ status: 'error', reason: 'not_wired' }, 405);
}

export function mcpRoutes(deps: Pick<AppDeps, 'clock'>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', withAgentPrincipal());
  routes.post('/', (c) => serve(c, deps));
  routes.get('/', postOnly);
  routes.delete('/', postOnly);
  return routes;
}
