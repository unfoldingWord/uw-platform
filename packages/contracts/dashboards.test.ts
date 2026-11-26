import { describe, expect, it } from 'vitest';
import {
  dashboardContextSchema,
  dashboardFrontmatterSchema,
  metricContextSchema,
  panelSchema,
} from './dashboards.ts';
import {
  activateDashboardCommandSchema,
  activateMeasureCommandSchema,
  measureRunCommandSchema,
} from './measure-commands.ts';
import { platformCommandNameSchema } from './platform-commands.ts';

const measure = '00000000-0000-4000-8000-0000000034a1';
const page = '00000000-0000-4000-8000-0000000034b1';
const requestId = '00000000-0000-4000-8000-0000000034c1';

describe('ADR 0036 a dashboard context selects resources and never grants', () => {
  it.each([
    { kind: 'organization', resource_kind: 'website' },
    { kind: 'page', page_id: page, descendants: true },
    { kind: 'resources', resource_ids: [page] },
    { kind: 'host', descendants: false },
  ])('accepts %j', (context) => {
    expect(dashboardFrontmatterSchema.parse({ context })).toEqual({ context });
  });

  it.each([
    { kind: 'organization', resource_kind: 'product' },
    { kind: 'page', page_id: page },
    { kind: 'resources', resource_ids: [] },
    { kind: 'resources', resource_ids: [page, page] },
    { kind: 'area', area: '00-09' },
  ])('refuses %j', (context) => {
    expect(dashboardContextSchema.safeParse(context).success).toBe(false);
  });

  it('reads a metric for any context but the page it is shown on', () => {
    expect(metricContextSchema.safeParse({ kind: 'host', descendants: false }).success).toBe(false);
    expect(
      metricContextSchema.safeParse({ kind: 'organization', resource_kind: 'website' }).success,
    ).toBe(true);
  });
});

describe('ADR 0036 a panel is one of six native kinds', () => {
  it.each([
    { kind: 'figure', measure, metric: 'latest_score', title: 'Average score' },
    { kind: 'bars', measure, metric: 'latest_score' },
    {
      kind: 'table',
      measure,
      values: [{ value: 'score', threshold: { op: 'at_least', threshold: 90 } }, { value: 'seo' }],
    },
    { kind: 'trend', measure, metric: 'score_over_time' },
    { kind: 'list', measure, value: 'fixes' },
    { kind: 'status', measure },
  ])('accepts a $kind panel', (panel) => {
    expect(panelSchema.parse(panel)).toEqual(panel);
  });

  it.each([
    { kind: 'html', measure, source: '<script></script>' },
    { kind: 'figure', measure },
    { kind: 'figure', measure: 'GEO', metric: 'latest_score' },
    { kind: 'table', measure, values: [] },
    { kind: 'table', measure, values: [{ value: 'score' }, { value: 'score' }] },
    { kind: 'status', measure, colour: 'red' },
  ])('refuses %j', (panel) => {
    expect(panelSchema.safeParse(panel).success).toBe(false);
  });
});

describe('ADR 0036 the person commands of a measure and a dashboard', () => {
  it('names Run trial, Activate, Run now and dashboard activation as platform commands', () => {
    for (const name of [
      'run_measure_trial',
      'activate_measure',
      'run_measure_now',
      'activate_dashboard',
    ]) {
      expect(platformCommandNameSchema.safeParse(name).success, name).toBe(true);
    }
  });
});

describe('ADR 0036 the bodies of the measure and dashboard commands', () => {
  it('runs a trial or a run now at the version the person saw', () => {
    const trial = {
      command: 'run_measure_trial',
      requestId,
      measureId: measure,
      expectedVersion: 2,
    };
    expect(measureRunCommandSchema.parse(trial)).toEqual(trial);
    const now = { ...trial, command: 'run_measure_now' };
    expect(measureRunCommandSchema.safeParse(now).success).toBe(true);
    expect(measureRunCommandSchema.safeParse({ ...trial, expectedVersion: 0 }).success).toBe(false);
    expect(
      measureRunCommandSchema.safeParse({ ...trial, command: 'activate_measure' }).success,
    ).toBe(false);
  });

  it('activates a measure with the suggested dashboards the person ticked, none by default', () => {
    const activate = {
      command: 'activate_measure',
      requestId,
      measureId: measure,
      expectedVersion: 3,
    };
    expect(activateMeasureCommandSchema.parse(activate)).toEqual({ ...activate, dashboards: [] });
    expect(
      activateMeasureCommandSchema.safeParse({ ...activate, dashboards: [page, page] }).success,
    ).toBe(false);
  });

  it('activates a dashboard at the version the person saw', () => {
    const activate = {
      command: 'activate_dashboard',
      requestId,
      dashboardId: page,
      expectedVersion: 1,
    };
    expect(activateDashboardCommandSchema.parse(activate)).toEqual(activate);
    expect(
      activateDashboardCommandSchema.safeParse({ ...activate, dashboardId: 'x' }).success,
    ).toBe(false);
  });
});

describe('ADR 0036 a measure or dashboard command carries only the fields it names', () => {
  it('refuses a field the command does not name, so a body cannot carry a lock or a status', () => {
    const base = { requestId, expectedVersion: 1 };
    const run = { ...base, command: 'run_measure_now', measureId: measure, lock: 'x==1' };
    const measureOn = {
      ...base,
      command: 'activate_measure',
      measureId: measure,
      status: 'active',
    };
    const dashboardOn = {
      ...base,
      command: 'activate_dashboard',
      dashboardId: page,
      area: '00-09',
    };
    expect(measureRunCommandSchema.safeParse(run).success).toBe(false);
    expect(activateMeasureCommandSchema.safeParse(measureOn).success).toBe(false);
    expect(activateDashboardCommandSchema.safeParse(dashboardOn).success).toBe(false);
  });
});
