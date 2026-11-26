import type { Child } from 'hono/jsx';
import type { Executor } from '@uw/db/client';
import { Section } from '@uw/ui/components/section.tsx';
import type { Rendered } from '../../markdown/render.ts';
import { placedPanels, type PlacedPanel } from '../../markdown/panel-embeds.ts';
import { dashboardRead, type DashboardRead } from '../../measures/dashboard-reads.ts';
import type { DashboardPage } from '../../measures/measure-pages.ts';
import type { Reader } from '../../measures/metric-reads.ts';
import { readableDashboard } from '../../measures/previews.ts';
import { reportCardsFor, type ReportCard } from '../../measures/report-cards.ts';
import type { ScreenKernel } from './frame.tsx';
import { pageLink } from './page-shown.ts';
import { PanelView, UnreadablePanelView } from './panel-views.tsx';
import { panelCsvPath, pagePath } from './paths.ts';

type Page = { readonly id: string; readonly type: string };

type Placing = {
  readonly read: DashboardRead;
  readonly dashboardId: string;
  readonly scope: string;
  readonly host: string | null;
};

const HOSTED =
  '<p data-embed-notice="" class="m-0 text-sm text-text-3">This report card takes the page it is shown on as its context, so its panels are drawn on each page that a resource of its measure serves.</p>';

function readerOf(db: Executor, screen: ScreenKernel): Reader {
  return { db, actor: screen.caller.actor, at: screen.at };
}

function shownPanels(placing: Placing): ReadonlyMap<number, Child> {
  const { read, dashboardId, scope, host } = placing;
  const shown = new Map<number, Child>();
  for (const placed of read.panels) {
    const panel = {
      panel: placed.panel,
      index: placed.index,
      scope,
      read: placed.read,
      csv: panelCsvPath(dashboardId, placed.index, host),
    };
    shown.set(placed.index, <PanelView shown={panel} />);
  }
  for (const each of read.unreadable) {
    shown.set(
      each.index,
      <UnreadablePanelView index={each.index} scope={scope} problem={each.problem} />,
    );
  }
  return new Map([...shown].sort(([a], [b]) => a - b));
}

function Panels(props: { readonly placing: Placing }) {
  return <>{[...shownPanels(props.placing).values()]}</>;
}

async function drawnPanels(placing: Placing): Promise<ReadonlyMap<number, string>> {
  const drawn = new Map<number, string>();
  for (const [index, child] of shownPanels(placing)) {
    drawn.set(index, String(await (<>{child}</>).toString()));
  }
  return drawn;
}

function ownerOf(page: Page, placed: PlacedPanel): string | null {
  if (placed.pageId !== null) return placed.pageId;
  return page.type === 'dashboard' ? page.id : null;
}

type Drawn = { readonly areas: readonly string[] } & (
  | { readonly kind: 'hosted' }
  | { readonly kind: 'panels'; readonly html: ReadonlyMap<number, string> }
);

export type PanelsRendered = Rendered & { readonly areas: readonly string[] };

function hostOf(page: Page, dashboard: DashboardPage): string | null {
  return dashboard.id !== page.id && dashboard.context.kind === 'host' ? page.id : null;
}

async function drawnFor(reader: Reader, page: Page, owner: string): Promise<Drawn | null> {
  const dashboard = await readableDashboard(reader, owner);
  if (dashboard === null) return null;
  const host = hostOf(page, dashboard);
  const read = await dashboardRead(reader, dashboard, host);
  const areas = [dashboard.jdArea, ...read.areas];
  if (read.context === null) return { kind: 'hosted', areas };
  const scope = dashboard.id === page.id ? dashboard.id : `${dashboard.id}-in-${page.id}`;
  const html = await drawnPanels({ read, dashboardId: dashboard.id, scope, host });
  return { kind: 'panels', html, areas };
}

async function drawnByOwner(reader: Reader, page: Page, placed: readonly PlacedPanel[]) {
  const owners = new Set(placed.flatMap((each) => ownerOf(page, each) ?? []));
  const drawn = new Map<string, Drawn | null>();
  for (const owner of owners) drawn.set(owner, await drawnFor(reader, page, owner));
  return drawn;
}

function textFor(drawn: Drawn, each: PlacedPanel, first: boolean): string {
  if (drawn.kind === 'hosted') return first ? HOSTED : '';
  return drawn.html.get(each.index) ?? '';
}

export async function withPanels(
  db: Executor,
  screen: ScreenKernel,
  page: Page,
  rendered: Rendered,
): Promise<PanelsRendered> {
  const placed = placedPanels(rendered.html);
  if (placed.length === 0) return { ...rendered, areas: [] };
  const drawn = await drawnByOwner(readerOf(db, screen), page, placed);
  const started = new Set<string>();
  const areas = new Set<string>();
  let html = '';
  let from = 0;
  for (const each of placed) {
    const owner = ownerOf(page, each);
    const panels = owner === null ? null : (drawn.get(owner) ?? null);
    if (owner === null || panels === null) continue;
    html += rendered.html.slice(from, each.start) + textFor(panels, each, !started.has(owner));
    started.add(owner);
    for (const area of panels.areas) areas.add(area);
    from = each.end;
  }
  return { ...rendered, html: html + rendered.html.slice(from), areas: [...areas] };
}

async function reportCardBlock(props: { readonly card: ReportCard; readonly reader: Reader }) {
  const { card, reader } = props;
  const read = await dashboardRead(reader, card.dashboard, card.hostPageId);
  const placing = {
    read,
    dashboardId: card.dashboard.id,
    scope: `${card.dashboard.id}-${card.hostPageId}`,
    host: card.hostPageId,
  };
  return (
    <section
      data-report-card={card.dashboard.id}
      aria-label={card.dashboard.title}
      class="flex flex-col gap-5"
    >
      <p class="m-0 text-sm">
        <a href={pagePath(card.dashboard.id)} class={pageLink}>
          {card.dashboard.title}
        </a>
        <span class="text-text-3">{`, from ${card.measure.title}`}</span>
      </p>
      <Panels placing={placing} />
    </section>
  );
}

export async function reportCardSection(
  db: Executor,
  screen: ScreenKernel,
  pageId: string,
): Promise<Child> {
  const reader = readerOf(db, screen);
  const cards = await reportCardsFor(reader, pageId);
  if (cards.length === 0) return null;
  return (
    <Section title="Measures" headingId="measures-heading" attrs={{ 'data-report-cards': '' }}>
      {await Promise.all(cards.map((card) => reportCardBlock({ card, reader })))}
    </Section>
  );
}
