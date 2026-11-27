import { describe, expect, it } from 'vitest';
import type { Panel } from '@uw/contracts';
import { dashboardBody, panelBlocks } from './panel-blocks.ts';

const MEASURE = '00000000-0000-4000-8000-0000000034a1';

const panels: readonly Panel[] = [
  { kind: 'figure', measure: MEASURE, metric: 'average_score', title: 'Average score' },
  { kind: 'bars', measure: MEASURE, metric: 'latest_score' },
  {
    kind: 'table',
    measure: MEASURE,
    values: [{ value: 'score', threshold: { op: 'at_least', threshold: 90 } }, { value: 'fixes' }],
  },
  { kind: 'status', measure: MEASURE },
];

describe('panels written into a dashboard body as fenced panel blocks', () => {
  it('writes the intro then one fenced panel block of YAML per panel', () => {
    const body = dashboardBody('The GEO score of every website we maintain.', panels);
    expect(body.startsWith('The GEO score of every website we maintain.\n\n```panel\n')).toBe(true);
    expect(body.match(/^```panel$/gm)).toHaveLength(4);
    expect(body).toContain('kind: figure\n');
    expect(body.endsWith('```\n')).toBe(true);
  });

  it('reads back exactly the panels it wrote, in order', () => {
    const body = dashboardBody('', panels);
    expect(panelBlocks(body)).toEqual(panels.map((panel, index) => ({ index, panel })));
  });

  it('names the problems of a block that is not YAML or not a panel, and keeps the others', () => {
    const body = [
      'Intro',
      '```panel',
      'kind: [figure',
      '```',
      '```panel',
      'kind: chart',
      `measure: ${MEASURE}`,
      '```',
      '```yaml',
      'kind: figure',
      '```',
      '```panel',
      'kind: status',
      `measure: ${MEASURE}`,
      '```',
    ].join('\n');
    const blocks = panelBlocks(body);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      index: 0,
      problems: [{ path: 'panels.0', message: 'the block is not YAML' }],
    });
    expect(blocks[1]).toMatchObject({ index: 1, problems: [{ path: 'panels.1.kind' }] });
    expect(blocks[2]).toEqual({ index: 2, panel: { kind: 'status', measure: MEASURE } });
  });

  it('refuses a repeated key rather than keeping the last one', () => {
    const body = ['```panel', 'kind: status', 'kind: figure', `measure: ${MEASURE}`, '```'].join(
      '\n',
    );
    expect(panelBlocks(body)[0]).toEqual({
      index: 0,
      problems: [{ path: 'panels.0', message: 'the block is not YAML' }],
    });
  });
});
