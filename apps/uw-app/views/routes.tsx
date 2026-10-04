import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';
import { boardScreen } from './screens/board.tsx';
import { flowScreen } from './screens/flow.tsx';
import { homeScreen } from './screens/home.tsx';

export function viewRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', homeScreen);
  routes.get('/harnesses/:harnessId', flowScreen);
  routes.get('/harnesses/:harnessId/board', boardScreen);
  return routes;
}
