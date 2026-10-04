import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';
import { homeScreen } from './screens/home.tsx';

export function viewRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', homeScreen);
  return routes;
}
