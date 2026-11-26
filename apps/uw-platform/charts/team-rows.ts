import type { ChartExcludedEntry, ChartExcludedReason } from '@uw/contracts';
import { pageOf, shownPortfolios, type TeamMember, type TeamRead } from '../people/team-model.ts';
import { leftOutOf, type ChartRow, type QueryRead } from './query-types.ts';

const NO_PORTFOLIO = 'No portfolio';
const NO_RING = 'No ring';

const ringWords: ReadonlyMap<string, string> = new Map([
  ['core', 'Core'],
  ['extended', 'Extended'],
  ['partner', 'Partner'],
]);

const ringOrder = [...ringWords.keys()];

function ringWord(ring: string | null): string {
  if (ring === null) return NO_RING;
  return (
    ringWords.get(ring) ?? `${ring.charAt(0).toUpperCase()}${ring.slice(1).replaceAll('_', ' ')}`
  );
}

function ringRank(ring: string | null): number {
  if (ring === null) return ringOrder.length + 1;
  const known = ringOrder.indexOf(ring);
  return known === -1 ? ringOrder.length : known;
}

type Placed = { readonly target: string; readonly kind: string; readonly portfolio: string };

function placedOn(read: TeamRead, pageId: string): Placed | ChartExcludedEntry | null {
  const page = pageOf(read, pageId);
  if (page.state === 'hidden') return null;
  if (page.state === 'retired') {
    return { reason: 'page_retired', subject: '', named: page.title, candidates: [] };
  }
  if (page.kind === 'portfolio') {
    return { target: page.title, kind: 'Portfolio', portfolio: page.title };
  }
  const parent = page.portfolioId === null ? null : pageOf(read, page.portfolioId);
  const portfolio = parent?.state === 'shown' ? parent.title : NO_PORTFOLIO;
  return { target: page.title, kind: 'Program', portfolio };
}

function hiddenEntry(subject: string): ChartExcludedEntry {
  return { reason: 'page_not_readable', subject, named: null, candidates: [] };
}

function portfolioRank(read: TeamRead): (title: string) => number {
  const titles = shownPortfolios(read).map((portfolio) => portfolio.title);
  return (title) => {
    const at = titles.indexOf(title);
    return at === -1 ? titles.length : at;
  };
}

export function allocationRows(read: TeamRead): QueryRead {
  const members = new Map(read.members.map((member) => [member.id, member]));
  const counted: ChartExcludedReason[] = [];
  const entries: ChartExcludedEntry[] = [];
  const rows: (ChartRow & Placed & { person: string })[] = [];
  for (const allocation of read.allocations) {
    const person = members.get(allocation.personId);
    if (person === undefined) {
      counted.push('person_not_readable');
      continue;
    }
    const placed = placedOn(read, allocation.pageId);
    if (placed === null) entries.push(hiddenEntry(person.name));
    else if ('reason' in placed) entries.push({ ...placed, subject: person.name });
    else rows.push({ person: person.name, ...placed, percent: allocation.percent });
  }
  const rank = portfolioRank(read);
  rows.sort(
    (a, b) =>
      rank(a.portfolio) - rank(b.portfolio) ||
      a.target.localeCompare(b.target) ||
      a.person.localeCompare(b.person),
  );
  return { rows, excluded: leftOutOf(counted, entries) };
}

type Seat = { readonly portfolio: string; readonly ring: string | null; readonly name: string };

function seatsOf(read: TeamRead, member: TeamMember, entries: ChartExcludedEntry[]): Seat[] {
  if (member.portfolioIds.length === 0) {
    return [{ portfolio: NO_PORTFOLIO, ring: member.ring, name: member.name }];
  }
  return member.portfolioIds.flatMap((pageId) => {
    const page = pageOf(read, pageId);
    if (page.state === 'shown' && page.kind === 'portfolio') {
      return [{ portfolio: page.title, ring: member.ring, name: member.name }];
    }
    const named = page.state === 'retired' ? page.title : null;
    const reason = page.state === 'retired' ? 'page_retired' : 'page_not_readable';
    entries.push({ reason, subject: member.name, named, candidates: [] });
    return [];
  });
}

function gridOf(read: TeamRead, seats: readonly Seat[]) {
  const portfolios = shownPortfolios(read).map((portfolio) => portfolio.title);
  const unplaced = seats.some((seat) => seat.portfolio === NO_PORTFOLIO) ? [NO_PORTFOLIO] : [];
  const rings = [...new Set(seats.map((seat) => seat.ring))].sort(
    (a, b) => ringRank(a) - ringRank(b) || (a ?? '').localeCompare(b ?? ''),
  );
  return { columns: [...portfolios, ...unplaced], rings };
}

export function peopleRows(read: TeamRead): QueryRead {
  const entries: ChartExcludedEntry[] = [];
  const seats = read.members.flatMap((member) => seatsOf(read, member, entries));
  const { columns, rings } = gridOf(read, seats);
  const rows = columns.flatMap((portfolio) =>
    rings.map((ring) => {
      const names = seats
        .filter((seat) => seat.portfolio === portfolio && seat.ring === ring)
        .map((seat) => seat.name)
        .sort((a, b) => a.localeCompare(b));
      return { portfolio, ring: ringWord(ring), headcount: names.length, names: names.join(', ') };
    }),
  );
  return { rows, excluded: leftOutOf([], entries) };
}
