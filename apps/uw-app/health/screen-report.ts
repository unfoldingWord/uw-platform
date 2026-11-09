import type { Context } from 'hono';
import type { HealthReport, Principal } from '@uw/contracts';
import type { AppDeps, AppEnv } from '../deps.ts';
import type { DatabaseHandle } from '../database.ts';
import { platformKernel } from '../kernel.ts';
import { agentPlaneIndicators } from './agent-plane.ts';
import type { HubHealth } from './hub.ts';
import { healthReport, overallStatus } from './indicators.ts';
import { spendCapOf } from './spend-cap.ts';

export type HealthDeps = Pick<AppDeps, 'clock' | 'timers'>;

export function platformReport(
  c: Context<AppEnv>,
  deps: HealthDeps,
  hubHealth: HubHealth,
): Promise<HealthReport> {
  const probe = { clock: () => Date.now(), timers: deps.timers, hubHealth };
  return healthReport(c.env, c.get('database'), probe);
}

export async function screenReport(
  c: Context<AppEnv>,
  deps: HealthDeps,
  hubHealth: HubHealth,
  seen: { readonly database: DatabaseHandle; readonly principal: Principal },
): Promise<HealthReport> {
  const platform = await platformReport(c, deps, hubHealth);
  const plane = await agentPlaneIndicators({
    kernel: platformKernel(seen.database, deps.clock),
    caller: { actor: seen.principal, traceId: c.get('traceId') },
    db: seen.database.db,
    at: c.get('now'),
    cap: spendCapOf(c.env),
  });
  const indicators = [...platform.indicators, ...plane];
  return { status: overallStatus(indicators), commit: platform.commit, indicators };
}
