import { describe, expect, it } from 'vitest';
import { chartLineageSchema, chartQueryParamsSchemas, chartSpecSchema } from './chart-spec.ts';
import {
  addCommitmentCommandSchema,
  removeCommitmentCommandSchema,
  removeStaffAllocationCommandSchema,
  setStaffAllocationCommandSchema,
} from './team-commands.ts';

const requestId = '00000000-0000-4000-8000-000000200c01';
const ada = '00000000-0000-4000-8000-000000200c02';
const sam = '00000000-0000-4000-8000-000000200c03';
const program = '00000000-0000-4000-8000-000000200c04';

const network = {
  title: 'Commitments network',
  type: 'graph',
  query: { key: 'team_commitments', params: {} },
  encodings: { x: 'from', y: ['entries'], series: null, target: 'to' },
  format: { x: 'text', y: 'count', currency: null },
};

const allocation = {
  title: 'Staff allocation',
  type: 'bipartite',
  query: { key: 'staff_allocations', params: {} },
  encodings: { x: 'person', y: ['percent'], series: null, target: 'target', group: 'portfolio' },
  format: { x: 'text', y: 'percent', currency: null },
};

describe('#200 a chart spec draws a graph from a source and a target column', () => {
  it('#200 accepts a graph and a grouped two-column graph, each naming its target', () => {
    expect(chartSpecSchema.parse(network)).toEqual(network);
    expect(chartSpecSchema.parse(allocation)).toEqual(allocation);
  });

  it.each([
    [
      'a graph with no target',
      { ...network, encodings: { ...network.encodings, target: undefined } },
    ],
    ['a bar chart with a target', { ...network, type: 'bar' }],
    [
      'a line chart with a group',
      { ...network, type: 'line', encodings: { x: 'a', y: ['b'], series: null, group: 'c' } },
    ],
  ])('#200 refuses %s', (_why, bad) => {
    expect(chartSpecSchema.safeParse(bad).success).toBe(false);
  });

  it('#200 the team queries take no parameters', () => {
    for (const key of ['team_commitments', 'staff_allocations', 'people_by_portfolio'] as const) {
      expect(chartQueryParamsSchemas[key].safeParse({}).success).toBe(true);
      expect(chartQueryParamsSchemas[key].safeParse({ harnessId: ada }).success).toBe(false);
    }
  });
});

describe('#200 the data-quality note is the lineage’s list of entries left out', () => {
  const lineage = {
    source: 'person_commitments',
    query: 'team_commitments',
    asOf: '2026-11-26T09:00:00.000Z',
    filters: {},
    excluded: {
      count: 2,
      reasons: [
        { reason: 'ambiguous_name', count: 1 },
        { reason: 'person_not_readable', count: 1 },
      ],
      entries: [
        {
          reason: 'ambiguous_name',
          subject: 'Lee-Anne Placeholder',
          named: 'Sam',
          candidates: ['Sam Sample', 'Sam Specimen'],
        },
      ],
    },
    stale: null,
    capped: null,
  };

  it('#200 accepts an ambiguous entry with its candidates beside a counted reason', () => {
    expect(chartLineageSchema.parse(lineage)).toEqual(lineage);
  });

  it('#200 refuses more entries of a reason than the count left out for it', () => {
    const [entry] = lineage.excluded.entries;
    const wrong = {
      ...lineage,
      excluded: { ...lineage.excluded, entries: [entry, entry] },
    };
    expect(chartLineageSchema.safeParse(wrong).success).toBe(false);
  });
});

describe('#200 the commitment and allocation commands', () => {
  it('#200 a commitment names a person or a text, exactly one', () => {
    const base = { command: 'add_commitment', requestId, fromPersonId: ada };
    expect(
      addCommitmentCommandSchema.safeParse({ ...base, toPersonId: sam, toText: null }).success,
    ).toBe(true);
    expect(
      addCommitmentCommandSchema.safeParse({ ...base, toPersonId: null, toText: 'Sam' }).success,
    ).toBe(true);
    expect(
      addCommitmentCommandSchema.safeParse({ ...base, toPersonId: sam, toText: 'Sam' }).success,
    ).toBe(false);
    expect(
      addCommitmentCommandSchema.safeParse({ ...base, toPersonId: null, toText: '  ' }).success,
    ).toBe(false);
    expect(
      removeCommitmentCommandSchema.safeParse({
        command: 'remove_commitment',
        requestId,
        commitmentId: sam,
      }).success,
    ).toBe(true);
  });

  it('#200 an allocation names a program or a portfolio and a whole percent from 0 to 100, or none', () => {
    const base = {
      command: 'set_staff_allocation',
      requestId,
      personId: ada,
      target: { kind: 'program', pageId: program },
    };
    for (const percent of [0, 100, null]) {
      expect(setStaffAllocationCommandSchema.safeParse({ ...base, percent }).success).toBe(true);
    }
    for (const percent of [-1, 101, 12.5]) {
      expect(setStaffAllocationCommandSchema.safeParse({ ...base, percent }).success).toBe(false);
    }
    const team = { ...base, percent: 10, target: { kind: 'team', pageId: program } };
    expect(setStaffAllocationCommandSchema.safeParse(team).success).toBe(false);
    const removal = { command: 'remove_staff_allocation', requestId, allocationId: program };
    expect(removeStaffAllocationCommandSchema.safeParse(removal).success).toBe(true);
  });
});
