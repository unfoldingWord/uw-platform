import { describe, expect, it } from 'vitest';
import type { MeasureFrontmatter } from '@uw/contracts';
import {
  filledCommand,
  hostOf,
  hostsReached,
  measurableAddress,
  nextRunAfter,
  runMinuteOf,
  toolHashOf,
} from './tool.ts';

const measure: MeasureFrontmatter = {
  runtime: 'uvx',
  package: 'geo-optimizer-skill==4.19.10',
  command: ['geo', 'audit', '--url', '{address}', '--host={host}'],
  resources: { view: 'c0110000-0000-4000-8000-000000000701' },
  schedule: { every: 'month', day: 1 },
  values: [],
  metrics: [],
  report_card: null,
};

describe('the tool a measure runs', () => {
  it('hashes only the runtime, package, command and resources, whatever the key order', async () => {
    const hash = await toolHashOf(measure);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const valued = {
      ...measure,
      schedule: { every: 'day' as const },
      values: [{ key: 'score', name: 'Score', type: 'number' as const, path: '/score' }],
      report_card: '00000000-0000-4000-8000-0000000034b1',
    };
    expect(await toolHashOf(valued)).toBe(hash);
    expect(await toolHashOf({ ...measure, package: 'geo-optimizer-skill==4.19.11' })).not.toBe(
      hash,
    );
    expect(await toolHashOf({ ...measure, command: ['geo', 'audit', '{address}'] })).not.toBe(hash);
  });

  it('fills in only the address and host of the resource, argument by argument', () => {
    expect(filledCommand(measure.command, 'https://www.unfoldingword.org/')).toEqual([
      'geo',
      'audit',
      '--url',
      'https://www.unfoldingword.org/',
      '--host=www.unfoldingword.org',
    ]);
    expect(filledCommand(['x', '{address}'], 'https://a.example; rm -rf /')).toEqual([
      'x',
      'https://a.example; rm -rf /',
    ]);
  });

  it('reads the host of an address and refuses one that is not http or https', () => {
    expect(hostOf('https://door43.org:8443/en/')).toBe('door43.org:8443');
    expect(hostOf('ftp://door43.org/')).toBeNull();
    expect(hostOf('not an address')).toBeNull();
  });

  it("names the hosts a run may reach for an address: its own and its www. sibling's", () => {
    expect(hostsReached('https://www.unfoldingword.org/')).toEqual([
      'www.unfoldingword.org',
      'unfoldingword.org',
    ]);
    expect(hostsReached('https://door43.org:8443/en/')).toEqual([
      'door43.org:8443',
      'www.door43.org:8443',
    ]);
    expect(hostsReached('ftp://door43.org/')).toEqual([]);
  });
});

const measureId = 'c0110000-0000-4000-8000-0000000000a1';
const minute = runMinuteOf(measureId);
const sixAt = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day, 6, minute));

describe('when a measure runs next', () => {
  const at = new Date(Date.UTC(2026, 10, 25, 12, 0));

  it('runs daily at the next six in the morning, universal time, at its own minute', () => {
    expect(nextRunAfter({ every: 'day' }, at, measureId)).toEqual(sixAt(2026, 10, 26));
    const early = new Date(Date.UTC(2026, 10, 25, 5, 59));
    expect(nextRunAfter({ every: 'day' }, early, measureId)).toEqual(sixAt(2026, 10, 25));
  });

  it('runs weekly on the chosen weekday', () => {
    expect(nextRunAfter({ every: 'week', weekday: 1 }, at, measureId)).toEqual(sixAt(2026, 10, 30));
    expect(nextRunAfter({ every: 'week', weekday: 3 }, at, measureId)).toEqual(sixAt(2026, 11, 2));
  });

  it('runs monthly on the chosen day, rolling into the next year', () => {
    expect(nextRunAfter({ every: 'month', day: 1 }, at, measureId)).toEqual(sixAt(2026, 11, 1));
    const december = new Date(Date.UTC(2026, 11, 20));
    expect(nextRunAfter({ every: 'month', day: 1 }, december, measureId)).toEqual(
      sixAt(2027, 0, 1),
    );
    expect(nextRunAfter({ every: 'month', day: 28 }, at, measureId)).toEqual(sixAt(2026, 10, 28));
  });
});

describe('measures that share a schedule', () => {
  it('spread over the minutes of the hour, each always at the same minute', () => {
    const ids = Array.from(
      { length: 120 },
      (_, index) => `c0110000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const minutes = ids.map(runMinuteOf);
    expect(minutes.every((each) => Number.isInteger(each) && each >= 0 && each < 60)).toBe(true);
    expect(new Set(minutes).size).toBeGreaterThan(30);
    expect(ids.map(runMinuteOf)).toEqual(minutes);
    const slots = ids.map((id) => nextRunAfter({ every: 'day' }, new Date(0), id).getTime());
    expect(new Set(slots).size).toBe(new Set(minutes).size);
  });
});

describe('the address a sandbox may measure', () => {
  it('is a plain http or https address, without a user, a password or a great length', () => {
    expect(measurableAddress('https://www.unfoldingword.org/')).toBe(true);
    expect(measurableAddress('http://door43.org:8080/en/')).toBe(true);
    expect(measurableAddress('https://user:secret@example.org/')).toBe(false);
    expect(measurableAddress('https://user@example.org/')).toBe(false);
    expect(measurableAddress('ftp://door43.org/')).toBe(false);
    expect(measurableAddress(`https://example.org/${'a'.repeat(2048)}`)).toBe(false);
  });
});
