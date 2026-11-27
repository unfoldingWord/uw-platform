import {
  CHART_CANDIDATES_MOST,
  chartNoParamsSchema,
  type ChartExcludedEntry,
  type ChartExcludedReason,
  type ChartQueryKey,
} from '@uw/contracts';
import { accepted, type KernelOutcome } from '@uw/harness';
import { nameIndex, resolveTarget } from '../people/name-resolution.ts';
import type { TeamMember, TeamRead } from '../people/team-model.ts';
import { allocationRows, peopleRows } from './team-rows.ts';
import {
  leftOutOf,
  preparedWith,
  type ChartColumn,
  type ChartQuery,
  type ChartRow,
  type QueryRead,
} from './query-types.ts';

type Edge = {
  readonly from: TeamMember;
  readonly to: { readonly id: string; readonly name: string };
  resolvedBy: string;
  entries: number;
};

function teamQuery(
  source: string,
  columns: readonly ChartColumn[],
  rowsOf: (read: TeamRead) => QueryRead,
): ChartQuery {
  return {
    source,
    columns,
    live: true,
    prepare: (params) =>
      preparedWith(chartNoParamsSchema, params, () => ({
        harnessId: null,
        run: async (sources): Promise<KernelOutcome<QueryRead>> => {
          const read = await sources.team();
          return read.status === 'error' ? read : accepted(rowsOf(read.value));
        },
      })),
  };
}

type Tally = {
  readonly edges: Map<string, Edge>;
  readonly counted: ChartExcludedReason[];
  readonly entries: ChartExcludedEntry[];
};

function edgeRows(edges: Iterable<Edge>): readonly ChartRow[] {
  return [...edges]
    .map((edge) => ({
      from: edge.from.name,
      to: edge.to.name,
      resolvedBy: edge.resolvedBy,
      entries: edge.entries,
      fromId: edge.from.id,
      toId: edge.to.id,
    }))
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.fromId.localeCompare(b.fromId) ||
        a.to.localeCompare(b.to) ||
        a.toId.localeCompare(b.toId),
    );
}

function addEdge(tally: Tally, from: TeamMember, to: { id: string; name: string }, by: string) {
  const key = `${from.id}>${to.id}`;
  const known = tally.edges.get(key);
  if (known === undefined) tally.edges.set(key, { from, to, resolvedBy: by, entries: 1 });
  else known.entries += 1;
}

function listedCandidates(people: readonly { readonly id: string; readonly name: string }[]) {
  const names = [...people]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((person) => person.name);
  return {
    candidates: names.slice(0, CHART_CANDIDATES_MOST),
    moreCandidates: Math.max(0, names.length - CHART_CANDIDATES_MOST),
  };
}

function commitmentsOf(read: TeamRead): QueryRead {
  const members = new Map(read.members.map((member) => [member.id, member]));
  const index = nameIndex(read.members);
  const tally: Tally = { edges: new Map(), counted: [], entries: [] };
  for (const commitment of read.commitments) {
    const from = members.get(commitment.fromId);
    const resolved = from === undefined ? null : resolveTarget(index, commitment);
    if (from === undefined || resolved === null || resolved.kind === 'not_readable') {
      tally.counted.push('person_not_readable');
    } else if (resolved.kind === 'resolved') {
      addEdge(tally, from, resolved.person, resolved.by);
    } else {
      const names = resolved.kind === 'ambiguous' ? resolved.candidates : [];
      tally.entries.push({
        reason: resolved.kind === 'ambiguous' ? 'ambiguous_name' : 'unresolved_name',
        subject: from.name,
        named: commitment.toText,
        ...listedCandidates(names),
      });
    }
  }
  return {
    rows: edgeRows(tally.edges.values()),
    excluded: leftOutOf(tally.counted, tally.entries),
  };
}

const commitmentsQuery = teamQuery(
  'person_commitments, each resolved against the directory by id, full name, loose name or a unique first name',
  [
    { key: 'from', label: 'From', identity: 'fromId' },
    { key: 'to', label: 'Committed to', identity: 'toId' },
    { key: 'resolvedBy', label: 'Resolved by' },
    { key: 'entries', label: 'Entries' },
    { key: 'fromId', label: 'From id' },
    { key: 'toId', label: 'Committed to id' },
  ],
  commitmentsOf,
);

const allocationsQuery = teamQuery(
  'staff_allocations, each person to a program or a portfolio, grouped by the portfolio of its program',
  [
    { key: 'person', label: 'Person', identity: 'personId' },
    { key: 'target', label: 'Program or portfolio', identity: 'targetId' },
    { key: 'kind', label: 'Kind' },
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'percent', label: 'Percent' },
    { key: 'personId', label: 'Person id' },
    { key: 'targetId', label: 'Page id' },
  ],
  allocationRows,
);

const peopleQuery = teamQuery(
  'directory_entries, each person by the portfolios and ring in their entry',
  [
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'ring', label: 'Ring' },
    { key: 'headcount', label: 'People' },
    { key: 'names', label: 'Names' },
  ],
  peopleRows,
);

export const teamQueries: readonly (readonly [ChartQueryKey, ChartQuery])[] = [
  ['team_commitments', commitmentsQuery],
  ['staff_allocations', allocationsQuery],
  ['people_by_portfolio', peopleQuery],
];
