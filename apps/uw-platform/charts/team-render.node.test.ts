import { describe, expect, it } from 'vitest';
import { CHART_CANDIDATES_MOST, chartLineageSchema, renderedChartSchema } from '@uw/contracts';
import { accepted, refused } from '@uw/harness';
import type { TeamMember, TeamPage, TeamRead } from '../people/team-model.ts';
import { drawChart, renderedOf, type ChartSources } from './render.ts';
import { standardSpec } from './standard.ts';

const at = new Date('2026-11-27T12:00:00.000Z');

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function member(n: number, name: string): TeamMember {
  return { id: uuid(n), name, ring: null, portfolioIds: [] };
}

const ada = member(1, 'Ada Example');
const samOne = member(2, 'Sam Sample');
const samTwo = member(3, 'Sam Sample');

function shown(n: number, kind: 'portfolio' | 'program', title: string, portfolio?: number) {
  const page: TeamPage = {
    id: uuid(n),
    state: 'shown',
    kind,
    title,
    portfolioId: portfolio === undefined ? null : uuid(portfolio),
  };
  return [page.id, page] as const;
}

const empty: TeamRead = { members: [], pages: new Map(), commitments: [], allocations: [] };

function sources(read: TeamRead): ChartSources {
  return {
    at,
    daily: async () => refused('not_permitted'),
    history: async () => refused('not_permitted'),
    team: async () => accepted(read),
    freshness: async () => null,
  };
}

async function drawn(read: TeamRead, key: 'commitments_network' | 'staff_allocation') {
  const outcome = await drawChart(sources(read), standardSpec(key, {}), 'team');
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function occurrences(svg: string, text: string): number {
  return svg.split(`>${text}<`).length - 1;
}

describe('#200 a team graph keeps directory and page ids as its identities', () => {
  it('#200 two colleagues with one full name, each named by id, are two nodes and two edges', async () => {
    const commitments = [samOne, samTwo].map((to, index) => ({
      id: uuid(100 + index),
      fromId: ada.id,
      toPersonId: to.id,
      toText: null,
    }));
    const chart = await drawn(
      { ...empty, members: [ada, samOne, samTwo], commitments },
      'commitments_network',
    );
    const graph = chart.drawing.graph;
    expect(graph?.nodes.map((node) => node.id)).toEqual([ada.id, samOne.id, samTwo.id]);
    expect(graph?.edges.map((edge) => edge.to)).toEqual([samOne.id, samTwo.id]);
    expect(chart.table.rows.map((row) => row['toId'])).toEqual([samOne.id, samTwo.id]);
    expect(occurrences(renderedOf(chart).svg, 'Sam Sample')).toBe(2);
  });

  it('#200 two programs with one title in different portfolios are two targets in their own groups', async () => {
    const pages = new Map([
      shown(10, 'portfolio', 'Portfolio One'),
      shown(11, 'portfolio', 'Portfolio Two'),
      shown(12, 'program', 'Program Alpha', 10),
      shown(13, 'program', 'Program Alpha', 11),
    ]);
    const allocations = [12, 13].map((page, index) => ({
      id: uuid(200 + index),
      personId: ada.id,
      pageId: uuid(page),
      percent: 50,
    }));
    const chart = await drawn({ ...empty, members: [ada], pages, allocations }, 'staff_allocation');
    const targets = chart.drawing.graph?.nodes.filter((node) => node.side === 'target') ?? [];
    expect(targets.map((node) => [node.id, node.name, node.group])).toEqual([
      [uuid(12), 'Program Alpha', 'Portfolio One'],
      [uuid(13), 'Program Alpha', 'Portfolio Two'],
    ]);
    expect(chart.drawing.graph?.edges).toHaveLength(2);
    expect(occurrences(renderedOf(chart).svg, 'Program Alpha')).toBe(2);
  });
});

describe('#200 an ambiguity report stays within the chart response contract', () => {
  const many = Array.from({ length: CHART_CANDIDATES_MOST + 3 }, (_, index) =>
    member(300 + index, `Jo Example ${String(index + 1).padStart(2, '0')}`),
  );
  const lee = member(4, 'Lee-Anne Placeholder');
  const read: TeamRead = {
    ...empty,
    members: [lee, ...many],
    commitments: [{ id: uuid(400), fromId: lee.id, toPersonId: null, toText: 'Jo' }],
  };

  it('#200 a first name shared by more people than the contract lists names the first of them and counts the rest', async () => {
    const chart = await drawn(read, 'commitments_network');
    expect(chartLineageSchema.safeParse(chart.lineage).success).toBe(true);
    expect(renderedChartSchema.safeParse(renderedOf(chart)).success).toBe(true);
    const [entry] = chart.lineage.excluded.entries;
    expect(entry?.candidates).toEqual(
      many.slice(0, CHART_CANDIDATES_MOST).map((each) => each.name),
    );
    expect(entry?.moreCandidates).toBe(3);
  });

  it('#200 the data-quality note says how many candidates it does not name', async () => {
    const chart = await drawn(read, 'commitments_network');
    const note = chart.drawing.notes.find((line) => line.startsWith('Left out, ambiguous'));
    expect(note).toContain(
      `Jo Example ${String(CHART_CANDIDATES_MOST).padStart(2, '0')}, or 3 more people.`,
    );
  });
});
