import type { Context, Next } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../deps.ts';
import { refuse } from './outcomes.ts';

const sameOrigin = csrf();

export async function formGuard(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  try {
    return await sameOrigin(c, next);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return refuse(c, 'not_permitted');
    throw error;
  }
}
