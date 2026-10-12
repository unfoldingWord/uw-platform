import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';

export function meRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', (c) => c.json({ principal: c.get('principal') }));
  return routes;
}
