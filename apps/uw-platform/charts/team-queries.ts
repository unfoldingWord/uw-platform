import {
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

type Edge = { readonly from: TeamMember; readonly to: string; resolvedBy: string; entries: number };

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
      to: edge.to,
      resolvedBy: edge.resolvedBy,
      entries: edge.entries,
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function addEdge(tally: Tally, from: TeamMember, to: { id: string; name: string }, by: string) {
  const key = `${from.id}>${to.id}`;
  const known = tally.edges.get(key);
  if (known === undefined) tally.edges.set(key, { from, to: to.name, resolvedBy: by, entries: 1 });
  else known.entries += 1;
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
      const ambiguous = resolved.kind === 'ambiguous';
      tally.entries.push({
        reason: ambiguous ? 'ambiguous_name' : 'unresolved_name',
        subject: from.name,
        named: commitment.toText,
        candidates: ambiguous ? resolved.candidates.map((person) => person.name) : [],
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
    { key: 'from', label: 'From' },
    { key: 'to', label: 'Committed to' },
    { key: 'resolvedBy', label: 'Resolved by' },
    { key: 'entries', label: 'Entries' },
  ],
  commitmentsOf,
);

const allocationsQuery = teamQuery(
  'staff_allocations, each person to a program or a portfolio, grouped by the portfolio of its program',
  [
    { key: 'person', label: 'Person' },
    { key: 'target', label: 'Program or portfolio' },
    { key: 'kind', label: 'Kind' },
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'percent', label: 'Percent' },
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
