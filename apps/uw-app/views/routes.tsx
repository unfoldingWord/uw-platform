import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';
import { boardScreen } from './screens/board.tsx';
import { flowScreen } from './screens/flow.tsx';
import { gateScreen } from './screens/gate.tsx';
import { gatesScreen } from './screens/gates.tsx';
import { homeScreen } from './screens/home.tsx';
import { playScreen } from './screens/play.tsx';

export function viewRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', homeScreen);
  routes.get('/harnesses/:harnessId', flowScreen);
  routes.get('/harnesses/:harnessId/board', boardScreen);
  routes.get('/gates', gatesScreen);
  routes.get('/harnesses/:harnessId/gates/:itemId', gateScreen);
  routes.get('/harnesses/:harnessId/items/:itemId', playScreen);
  return routes;
}
