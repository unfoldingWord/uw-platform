import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { LiveScreen } from '@uw/contracts';
import type { Caller, Kernel } from '@uw/harness';
import { Shell } from '@uw/ui/components/shell.tsx';
import type { Crumb, Tab } from '@uw/ui/components/top-bar.tsx';
import { appCssPath } from '@uw/ui/generated/app-css';
import type { AppEnv } from '../../deps.ts';
import { islandsPath } from '../../generated/islands.ts';
import { refuse } from '../../http/outcomes.ts';
import { platformKernel } from '../../kernel.ts';
import { frameOf } from './frame-data.ts';

type LiveHarness = { readonly harnessId: string; readonly cursor: number };

export type ScreenSpec = {
  readonly title: string;
  readonly current: string;
  readonly crumbs: readonly Crumb[];
  readonly tabs?: readonly Tab[];
  readonly live?: {
    readonly screen: LiveScreen;
    readonly harnesses: readonly LiveHarness[];
    readonly itemId?: string;
    readonly refreshEveryMs?: number;
  };
  readonly status?: 200 | 404;
};

export type ScreenKernel = { readonly kernel: Kernel; readonly caller: Caller; readonly at: Date };

export function screenKernel(c: Context<AppEnv>): ScreenKernel | null {
  const database = c.get('database');
  const actor = c.get('principal');
  if (database === null || actor === null) return null;
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  return { kernel, caller: { actor, traceId: c.get('traceId') }, at };
}

export function screenRefusal(c: Context<AppEnv>): Response {
  return refuse(c, c.get('database') === null ? 'database_not_configured' : 'unauthenticated');
}

function LiveMarkers(props: { readonly live: ScreenSpec['live'] }) {
  const { live } = props;
  if (live === undefined) return null;
  const every = live.refreshEveryMs;
  if (live.harnesses.length === 0) {
    return every === undefined ? null : <div data-live="" data-refresh-every={every}></div>;
  }
  return (
    <>
      {live.harnesses.map((harness) => (
        <div
          data-live=""
          data-live-harness={harness.harnessId}
          data-live-screen={live.screen}
          data-live-item={live.itemId}
          data-cursor={harness.cursor}
          data-refresh-every={every}
        ></div>
      ))}
    </>
  );
}

export async function renderScreen(
  c: Context<AppEnv>,
  spec: ScreenSpec,
  body: Child,
): Promise<Response> {
  c.header('cache-control', 'no-store');
  c.header('vary', 'x-uw-fragment');
  const status = spec.status ?? 200;
  const main = (
    <>
      <LiveMarkers live={spec.live} />
      {body}
    </>
  );
  if (c.req.header('x-uw-fragment') === 'main') return c.html(main, status);
  const screen = screenKernel(c);
  const frame = await frameOf(c, () =>
    screen === null ? null : screen.kernel.views.frame(screen.caller, { at: screen.at }),
  );
  const page = (
    <Shell
      title={spec.title}
      frame={frame}
      current={spec.current}
      crumbs={spec.crumbs}
      tabs={spec.tabs}
      stylesheet={appCssPath}
      script={islandsPath}
    >
      {main}
    </Shell>
  );
  return c.html(`<!DOCTYPE html>${await page.toString()}`, status);
}
