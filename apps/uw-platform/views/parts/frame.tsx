import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import { wrapTime } from 'hono/timing';
import type { LiveScreen } from '@uw/contracts';
import type { Caller, Kernel } from '@uw/harness';
import { Shell, type Frame } from '@uw/ui/components/shell.tsx';
import type { NavItem, NavSection } from '@uw/ui/components/sidebar.tsx';
import type { Crumb, Tab } from '@uw/ui/components/top-bar.tsx';
import { appCssPath } from '@uw/ui/generated/app-css';
import type { AppEnv } from '../../deps.ts';
import { islandsPath } from '../../generated/islands.ts';
import { refuse } from '../../http/outcomes.ts';
import { platformKernel } from '../../kernel.ts';
import type { Printed } from '../../pdf/print-document.ts';
import { pdfOfScreen, screenPrinted } from '../../pdf/screen.ts';
import { frameOf } from './frame-data.ts';

type LiveHarness = { readonly harnessId: string; readonly cursor: number };

export type ScreenSpec = {
  readonly title: string;
  readonly current: string;
  readonly crumbs: readonly Crumb[];
  readonly tabs?: readonly Tab[];
  readonly code?: string;
  readonly live?: {
    readonly screen: LiveScreen;
    readonly harnesses: readonly LiveHarness[];
    readonly itemId?: string;
    readonly refreshEveryMs?: number;
  };
  readonly status?: 200 | 404;
  readonly branch?: Branch;
  readonly focus?: boolean;
  readonly bare?: boolean;
  readonly printed?: Printed;
};

export type Branch = { readonly under: string; readonly items: readonly NavItem[] };

function opened(items: readonly NavItem[], branch: Branch): readonly NavItem[] {
  return items.flatMap((item) =>
    item.href === branch.under ? [{ ...item, open: true }, ...branch.items] : [item],
  );
}

export function withBranch(
  sections: readonly NavSection[],
  branch: Branch | undefined,
): readonly NavSection[] {
  if (branch === undefined) return sections;
  return sections.map((section) => ({ ...section, items: opened(section.items, branch) }));
}

export type ScreenKernel = { readonly kernel: Kernel; readonly caller: Caller; readonly at: Date };

function readFrame(c: Context<AppEnv>, screen: ScreenKernel | null): Promise<Frame> {
  return wrapTime(
    c,
    'frame',
    frameOf(c, () =>
      screen === null ? null : screen.kernel.views.frame(screen.caller, { at: screen.at }),
    ),
  );
}

function wholePage(c: Context<AppEnv>): boolean {
  return c.req.method === 'GET' && c.req.header('x-uw-fragment') !== 'main';
}

const startedFrames = new WeakMap<Context<AppEnv>, Promise<Frame>>();

function startFrame(c: Context<AppEnv>, screen: ScreenKernel): void {
  if (!wholePage(c) || startedFrames.has(c)) return;
  const frame = readFrame(c, screen);
  frame.catch(() => undefined);
  startedFrames.set(c, frame);
}

export function screenKernel(c: Context<AppEnv>): ScreenKernel | null {
  const database = c.get('database');
  const actor = c.get('principal');
  if (database === null || actor === null) return null;
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const screen = { kernel, caller: { actor, traceId: c.get('traceId') }, at };
  startFrame(c, screen);
  return screen;
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

export function wantsPdf(c: Context<AppEnv>): boolean {
  return c.req.method === 'GET' && c.req.query('format') === 'pdf';
}

function printedScreen(c: Context<AppEnv>, spec: ScreenSpec, html: string): Promise<Response> {
  return pdfOfScreen(c, spec.title, html, spec.printed ?? screenPrinted(c, html));
}

export async function renderScreen(
  c: Context<AppEnv>,
  spec: ScreenSpec,
  body: Child,
): Promise<Response> {
  const status = spec.status ?? 200;
  const main = (
    <>
      <LiveMarkers live={spec.live} />
      {body}
    </>
  );
  if (status === 200 && wantsPdf(c)) return printedScreen(c, spec, String(await main.toString()));
  c.header('cache-control', 'no-store');
  c.header('vary', 'x-uw-fragment');
  c.header('link', `<${appCssPath}>; rel=preload; as=style, <${islandsPath}>; rel=modulepreload`);
  if (c.req.header('x-uw-fragment') === 'main') return c.html(main, status);
  const frame = await (startedFrames.get(c) ?? readFrame(c, screenKernel(c)));
  const page = (
    <Shell
      title={spec.title}
      frame={{ ...frame, sections: withBranch(frame.sections, spec.branch) }}
      current={spec.current}
      focus={spec.focus}
      bare={spec.bare}
      code={spec.code}
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
