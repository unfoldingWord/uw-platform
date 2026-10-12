import type { Bindings } from '../env.ts';
import { accessConfigFrom } from './access.ts';

const localHosts = new Set(['localhost', '127.0.0.1']);

export function devEmail(env: Bindings, url: string): string | null {
  if (accessConfigFrom(env) !== null) return null;
  if (!localHosts.has(new URL(url).hostname)) return null;
  return env.DEV_PRINCIPAL_EMAIL ?? null;
}
