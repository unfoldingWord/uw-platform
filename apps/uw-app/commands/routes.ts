import { Hono, type Context } from 'hono';
import type { AppDeps, AppEnv } from '../deps.ts';
import { answer, readJson } from '../http/commands.ts';
import { connectLive } from '../live/connect.ts';
import { hubOf } from '../ports/hub.ts';
import { notifierOf } from '../ports/notifier.ts';
import { runsOf } from '../ports/runs.ts';
import { requestLogger } from '../request-logger.ts';
import { executeCommand } from './dispatch.ts';
import type { PersonDeps } from './person-deps.ts';
import { gateView } from './person/gate-view.ts';
import { harnessEvents, stageItems } from './reads.ts';
import { commandRegistry } from './registry.ts';

async function handleCommand(
  c: Context<AppEnv>,
  deps: Pick<AppDeps, 'clock' | 'sink' | 'fetch'>,
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
  const logger = requestLogger(c);
  const outcome = await executeCommand(request, {
    database: c.get('database'),
    registry: commandRegistry,
    gateGitHub: () => person.gateGitHub(c.env, () => deps.clock.now()),
    hub: hubOf(c.env, logger),
    runs: runsOf(c.env),
    notifier: notifierOf(c.env, c.get('database'), deps.sink, deps.fetch),
    logger,
  });
  return answer(c, outcome);
}

export function harnessRoutes(
  deps: Pick<AppDeps, 'clock' | 'sink' | 'fetch'>,
  person: PersonDeps,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/:harness/commands/:name', (c) => handleCommand(c, deps, person));
  routes.get('/:harness/stages/:stage/items', stageItems);
  routes.get('/:harness/events', harnessEvents);
  routes.get('/:harness/gates/:item', gateView);
  routes.get('/:harness/live', connectLive);
  return routes;
}
