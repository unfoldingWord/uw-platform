import { describe, expect, it } from 'vitest';
import { measureFrontmatterSchema, measureScheduleSchema, metricSchema } from './measures.ts';

const geo = {
  runtime: 'uvx',
  package: 'geo-optimizer-skill==4.19.10',
  command: ['geo', 'audit', '--url', '{address}', '--format', 'json'],
  resources: { view: 'c0110000-0000-4000-8000-000000000701' },
  schedule: { every: 'month', day: 1 },
  values: [
    { key: 'score', name: 'GEO score', type: 'number', unit: 'points', path: '/score' },
    { key: 'scoring', name: 'Scoring version', type: 'text', path: '/scoring_version' },
    { key: 'fixes', name: 'Suggested fixes', type: 'text_list', path: '/recommendations' },
  ],
  metrics: [
    { key: 'latest_score', name: 'GEO score', value: 'score', rule: 'latest', target: 90 },
    {
      key: 'meeting_target',
      name: 'Sites meeting the target',
      value: 'score',
      rule: 'count_meeting',
      condition: { op: 'at_least', threshold: 90 },
    },
  ],
  report_card: null,
};

function accepts(overrides: Record<string, unknown>): boolean {
  return measureFrontmatterSchema.safeParse({ ...geo, ...overrides }).success;
}

function issuePaths(overrides: Record<string, unknown>): string[] {
  const parsed = measureFrontmatterSchema.safeParse({ ...geo, ...overrides });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('ADR 0036 a measure names a pinned tool and a command of plain arguments', () => {
  it('accepts the GEO measure the PRD walks through', () => {
    expect(measureFrontmatterSchema.parse(geo)).toEqual(geo);
  });

  it('takes only the uvx runtime in the first version', () => {
    expect(accepts({ runtime: 'npx' })).toBe(false);
  });

  it('pins the package to one exact version', () => {
    expect(accepts({ package: 'geo-optimizer-skill==4.19.10rc1' })).toBe(true);
    for (const loose of [
      'geo-optimizer-skill',
      'geo-optimizer-skill>=4.19',
      'geo-optimizer-skill==4.*',
      'geo-optimizer-skill==4.19.10; rm -rf /',
      'git+https://example.org/geo.git',
    ]) {
      expect(accepts({ package: loose }), loose).toBe(false);
    }
  });

  it('fills in only {address} and {host}, and needs one of them', () => {
    expect(accepts({ command: ['geo', 'audit', '--host', '{host}'] })).toBe(true);
    expect(accepts({ command: ['geo', 'audit', '--url', '{owner}'] })).toBe(false);
    expect(accepts({ command: ['geo', 'audit', '--url', '{address'] })).toBe(false);
    expect(accepts({ command: ['geo', 'audit'] })).toBe(false);
    expect(accepts({ command: [] })).toBe(false);
  });

  it('refuses a first argument that the runtime would read as its own option', () => {
    expect(accepts({ command: ['--with', 'other-package', '{address}'] })).toBe(false);
    expect(accepts({ command: ['geo audit', '{address}'] })).toBe(false);
  });

  it('refuses a command that starts with uvx, uv or an option, and says why', () => {
    const user = ['uvx', '--from', 'geo-optimizer-skill==4.19.10', 'geo', 'audit', '{address}'];
    for (const command of [user, ['uv', 'run', 'geo', '{address}'], ['--from', '{address}']]) {
      const parsed = measureFrontmatterSchema.safeParse({ ...geo, command });
      const messages = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
      expect(messages.join(' '), command.join(' ')).toMatch(/the tool the package installs/);
    }
  });

  it('refuses a control character in any argument', () => {
    expect(accepts({ command: ['geo', 'audit\n--url', '{address}'] })).toBe(false);
  });

  it('names the resources as one saved view and refuses any other field', () => {
    expect(accepts({ resources: { view: 'websites' } })).toBe(false);
    expect(accepts({ status: 'active' })).toBe(false);
  });
});

describe('ADR 0036 a measure schedule is daily, weekly on a weekday or monthly on a day', () => {
  it.each([{ every: 'day' }, { every: 'week', weekday: 0 }, { every: 'month', day: 28 }])(
    'accepts %j',
    (schedule) => {
      expect(measureScheduleSchema.safeParse(schedule).success).toBe(true);
    },
  );

  it.each([
    { every: 'week', weekday: 7 },
    { every: 'month', day: 29 },
    { every: 'month' },
    { every: 'hour' },
    { every: 'day', day: 1 },
  ])('refuses %j', (schedule) => {
    expect(measureScheduleSchema.safeParse(schedule).success).toBe(false);
  });
});

describe('ADR 0036 values are read by JSON pointer and metrics by a closed rule', () => {
  it('reads each value at an RFC 6901 JSON pointer', () => {
    const at = (path: string) => [{ key: 'score', name: 'Score', type: 'number', path }];
    expect(accepts({ values: at(''), metrics: [] })).toBe(true);
    expect(accepts({ values: at('/categories/0/points~1max'), metrics: [] })).toBe(true);
    expect(accepts({ values: at('score'), metrics: [] })).toBe(false);
    expect(accepts({ values: at('/a~2b'), metrics: [] })).toBe(false);
  });

  it('may name where the tool reports a failure, as a JSON pointer below the whole output', () => {
    expect(accepts({ failure_path: '/error' })).toBe(true);
    expect(accepts({ failure_path: '/errors/0~1first' })).toBe(true);
    expect(accepts({ failure_path: 'error' })).toBe(false);
    expect(accepts({ failure_path: '' })).toBe(false);
    expect(accepts({ failure_path: null })).toBe(false);
  });

  it('lets a measure be saved before its values are known', () => {
    expect(accepts({ values: [], metrics: [] })).toBe(true);
  });

  it('keeps each value and metric key once', () => {
    const twice = [geo.values[0], { ...geo.values[1], key: 'score' }];
    expect(issuePaths({ values: twice, metrics: [] })).toEqual(['values.1.key']);
    const metrics = [geo.metrics[0], { ...geo.metrics[0] }];
    expect(issuePaths({ metrics })).toEqual(['metrics.1.key']);
  });

  it('says which metric names a value the measure does not keep', () => {
    const metrics = [{ ...geo.metrics[0], value: 'speed' }];
    expect(issuePaths({ metrics })).toEqual(['metrics.0.value']);
  });

  it('works out averages, changes and counts only over number and percent values', () => {
    const metrics = [{ key: 'avg', name: 'Average', value: 'scoring', rule: 'average' }];
    expect(issuePaths({ metrics })).toEqual(['metrics.0.rule']);
    const latest = [{ key: 'version', name: 'Version', value: 'scoring', rule: 'latest' }];
    expect(accepts({ metrics: latest })).toBe(true);
  });

  it('sets a target only on a number or a percent', () => {
    const metrics = [{ key: 'v', name: 'Version', value: 'scoring', rule: 'latest', target: 2 }];
    expect(issuePaths({ metrics })).toEqual(['metrics.0.target']);
  });
});

describe('ADR 0036 a counting metric states its condition and no other does', () => {
  const base = { key: 'meeting', name: 'Meeting', value: 'score' };
  const condition = { op: 'at_least', threshold: 90 };

  it.each(['count_meeting', 'share_meeting'])('%s needs a condition', (rule) => {
    expect(metricSchema.safeParse({ ...base, rule }).success).toBe(false);
    expect(metricSchema.safeParse({ ...base, rule, condition }).success).toBe(true);
  });

  it('refuses a condition on a rule that does not count', () => {
    expect(metricSchema.safeParse({ ...base, rule: 'average', condition }).success).toBe(false);
  });

  it('refuses a condition outside at_least and at_most', () => {
    const over = { ...base, rule: 'count_meeting', condition: { op: 'over', threshold: 1 } };
    expect(metricSchema.safeParse(over).success).toBe(false);
  });
});
