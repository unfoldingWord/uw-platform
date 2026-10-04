import { Hono, type Context, type Next } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { boardScreen } from './screens/board.tsx';
import { flowScreen } from './screens/flow.tsx';
import { gateScreen } from './screens/gate.tsx';
import { gatesScreen } from './screens/gates.tsx';
import { homeScreen } from './screens/home.tsx';
import { saveToolset } from './parts/toolset-save.tsx';
import { personaScreen } from './screens/persona.tsx';
import { playScreen } from './screens/play.tsx';

const sameOrigin = csrf();

async function formGuard(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  try {
    return await sameOrigin(c, next);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return refuse(c, 'not_permitted');
    throw error;
  }
}

export function viewRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', homeScreen);
  routes.get('/harnesses/:harnessId', flowScreen);
  routes.get('/harnesses/:harnessId/board', boardScreen);
  routes.get('/gates', gatesScreen);
  routes.get('/harnesses/:harnessId/gates/:itemId', gateScreen);
  routes.get('/harnesses/:harnessId/items/:itemId', playScreen);
  routes.get('/personas/:pageId', personaScreen);
  routes.use('/personas/:pageId/toolset', formGuard);
  routes.post('/personas/:pageId/toolset', saveToolset);
  return routes;
}
