import { Hono, type Context } from 'hono';
import type { AppDeps, AppEnv } from '../deps.ts';
import { answer, readJson } from '../http/commands.ts';
import { requestLogger } from '../request-logger.ts';
import { executeCommand } from './dispatch.ts';
import type { PersonDeps } from './person-deps.ts';
import { commandRegistry } from './registry.ts';

async function handleCommand(
  c: Context<AppEnv>,
  deps: Pick<AppDeps, 'clock'>,
  person: PersonDeps,
): Promise<Response> {
  const request = {
    name: c.req.param('name') ?? '',
    harness: c.req.param('harness') ?? '',
    body: await readJson(c),
    principal: c.get('principal'),
    traceId: c.get('traceId'),
    at: c.get('now'),
  };
  const outcome = await executeCommand(request, {
    database: c.get('database'),
    registry: commandRegistry,
    gateGitHub: () => person.gateGitHub(c.env, () => deps.clock.now()),
    logger: requestLogger(c),
  });
  return answer(c, outcome);
}

export function harnessRoutes(deps: Pick<AppDeps, 'clock'>, person: PersonDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/:harness/commands/:name', (c) => handleCommand(c, deps, person));
  return routes;
}
