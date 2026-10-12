import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import { formatInstant } from '@uw/core/dates';
import { formatCount, formatMoney } from '@uw/core/money';
import type { PlaneIndicator } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { sweepsBacking } from '../../health/agent-plane.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { indicatorText } from '../parts/health-words.ts';
import { healthPath, homePath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

type Listing = {
  readonly columns: readonly { readonly key: string; readonly label: string }[];
  readonly rows: readonly Readonly<Record<string, Child>>[];
};

const planeIndicators: ReadonlySet<string> = new Set<PlaneIndicator>([
  'spend',
  'runs_today',
  'live_delegations',
  'gate_refusals_week',
  'agent_writes',
  'stale_learnings',
]);

function isPlane(name: string): name is PlaneIndicator {
  return planeIndicators.has(name);
}

function cellText(value: string | number | null): string {
  if (value === null) return 'None';
  return typeof value === 'number' ? formatCount(value) : value;
}

async function planeListing(screen: ScreenKernel, indicator: PlaneIndicator): Promise<Listing> {
  const rows = await screen.kernel.views.planeList(screen.caller, indicator, { at: screen.at });
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row.cells)))];
  return {
    columns: keys.map((key) => ({ key, label: reasonText(key) })),
    rows: rows.map((row) =>
      Object.fromEntries(Object.entries(row.cells).map(([key, value]) => [key, cellText(value)])),
    ),
  };
}

async function breakerListing(screen: ScreenKernel): Promise<Listing> {
  const { reading, at } = await screen.kernel.breaker.state(screen.at);
  const columns = [
    { key: 'level', label: 'Level' },
    { key: 'spent', label: 'Spent' },
    { key: 'cap', label: 'Cap' },
    { key: 'percent', label: 'Percent' },
    { key: 'at', label: 'Read at' },
  ];
  if (reading === null) return { columns, rows: [] };
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: reading.currency });
  const row = {
    level: reasonText(reading.level),
    spent: money(reading.spentMinor),
    cap: money(reading.capMinor),
    percent: `${reading.percent} percent`,
    at: at === null ? 'None' : formatInstant(new Date(at)),
  };
  return { columns, rows: [row] };
}

async function sweepListing(c: Context<AppEnv>, screen: ScreenKernel): Promise<Listing> {
  const database = c.get('database');
  const harnesses = await screen.kernel.views.harnesses(screen.caller, { at: screen.at });
  const backing = new Set(harnesses.flatMap((harness) => harness.repository ?? []));
  const repos = database === null ? [] : await sweepsBacking(database.db, backing);
  return {
    columns: [
      { key: 'repository', label: 'Repository' },
      { key: 'outcome', label: 'Last sweep' },
      { key: 'at', label: 'Swept at' },
      { key: 'through', label: 'Swept through' },
    ],
    rows: repos.map((repo) => ({
      repository: repo.fullName,
      outcome: repo.lastSweep === null ? 'Never' : reasonText(repo.lastSweep.outcome),
      at: repo.lastSweep === null ? 'None' : formatInstant(new Date(repo.lastSweep.at)),
      through: repo.sweptThrough === null ? 'None' : formatInstant(repo.sweptThrough),
    })),
  };
}

function listingOf(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  name: string,
): Promise<Listing> | null {
  if (isPlane(name)) return planeListing(screen, name);
  if (name === 'breaker') return breakerListing(screen);
  if (name === 'github_sweep') return sweepListing(c, screen);
  return null;
}

export async function healthListScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const name = c.req.param('indicator') ?? '';
  const pending = listingOf(c, screen, name);
  if (pending === null) return notFound(c);
  const listing = await pending;
  const title = indicatorText(name);
  const spec = {
    title,
    current: healthPath(),
    crumbs: [
      { label: 'Home', href: homePath() },
      { label: 'Health', href: healthPath() },
      { label: title },
    ],
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead eyebrow="Health" title={title} />
      {listing.rows.length === 0 ? (
        <Note>Nothing to list for you here.</Note>
      ) : (
        <Table caption={title} columns={listing.columns} rows={listing.rows} />
      )}
    </>,
  );
}
