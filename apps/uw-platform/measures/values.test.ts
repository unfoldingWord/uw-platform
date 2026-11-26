import { describe, expect, it } from 'vitest';
import type { MeasureValueDefinition } from '@uw/contracts';
import { readValues, valueReading } from './values.ts';

const values: readonly MeasureValueDefinition[] = [
  { key: 'score', name: 'Score', type: 'number', path: '/score' },
  { key: 'share', name: 'Share', type: 'percent', path: '/categories/0/share' },
  { key: 'version', name: 'Scoring version', type: 'text', path: '/meta/scoring~1version' },
  { key: 'fixes', name: 'Fixes', type: 'text_list', path: '/recommendations' },
  { key: 'indexed', name: 'Indexed', type: 'yes_no', path: '/indexed' },
];

const output = JSON.stringify({
  score: 81,
  categories: [{ share: 62.5 }],
  meta: { 'scoring/version': '2' },
  recommendations: ['Add an llms.txt', 'Describe images'],
  indexed: true,
});

describe("reading a measure's values from the tool's output", () => {
  it('reads every value at its JSON pointer', () => {
    expect(readValues(output, { values })).toEqual({
      ok: true,
      values: {
        score: 81,
        share: 62.5,
        version: '2',
        fixes: ['Add an llms.txt', 'Describe images'],
        indexed: true,
      },
    });
  });

  it('refuses output that is not JSON, and never turns it into zero', () => {
    expect(readValues('Score: 81', { values })).toEqual({ ok: false, reason: 'output_not_json' });
    expect(readValues('', { values })).toEqual({ ok: false, reason: 'output_not_json' });
  });

  it('refuses output that does not fit the values', () => {
    const missing = JSON.stringify({ score: 81 });
    expect(readValues(missing, { values })).toEqual({ ok: false, reason: 'output_unfit' });
    const text = JSON.stringify({ score: '81' });
    expect(readValues(text, { values: values.slice(0, 1) })).toEqual({
      ok: false,
      reason: 'output_unfit',
    });
    const list = JSON.stringify({ recommendations: ['a', 3] });
    expect(readValues(list, { values: values.slice(3, 4) })).toEqual({
      ok: false,
      reason: 'output_unfit',
    });
  });

  it('keeps nothing but a clean read when a measure has no values yet', () => {
    expect(readValues(output, { values: [] })).toEqual({ ok: true, values: {} });
    expect(readValues('[1]', { values: [] })).toEqual({ ok: true, values: {} });
  });

  it('reads the whole document at the empty pointer', () => {
    const whole = [{ key: 'n', name: 'N', type: 'number' as const, path: '' }];
    expect(readValues('42', { values: whole })).toEqual({ ok: true, values: { n: 42 } });
  });
});

describe('saying exactly which value does not read, and why', () => {
  it('names a pointer that finds nothing and a value of the wrong type', () => {
    const wrong: readonly MeasureValueDefinition[] = [
      { key: 'score', name: 'Score', type: 'number', path: '/result/score' },
      { key: 'band', name: 'Band', type: 'number', path: '/meta' },
      { key: 'share', name: 'Share', type: 'percent', path: '/categories/0/share' },
    ];
    expect(valueReading(output, { values: wrong })).toEqual({
      json: true,
      values: { share: 62.5 },
      failure: null,
      problems: [
        { index: 0, key: 'score', message: 'nothing at /result/score' },
        { index: 1, key: 'band', message: 'found an object at /meta, expected a number' },
      ],
    });
  });

  it('says when the output is not JSON at all', () => {
    expect(valueReading('Score: 81', { values })).toEqual({ json: false });
  });
});

describe('reading a failure the tool reports while it exits 0', () => {
  const refused = JSON.stringify({ score: 0, error: 'HTTP 403', recommendations: [] });
  const rule = { values: values.slice(0, 1), failure_path: '/error' };

  it('fails the output that holds anything at the failure path, and keeps no value', () => {
    expect(readValues(refused, rule)).toEqual({ ok: false, reason: 'tool_failed' });
    expect(valueReading(refused, rule)).toEqual({
      json: true,
      values: { score: 0 },
      problems: [],
      failure: 'the tool reported a failure at /error',
    });
    const listed = JSON.stringify({ score: 0, error: ['Connection failed'] });
    expect(readValues(listed, rule)).toEqual({ ok: false, reason: 'tool_failed' });
  });

  it('reads null, false, empty text or nothing at the failure path as success', () => {
    for (const error of [null, false, '', undefined]) {
      const fine = JSON.stringify({ score: 81, error });
      expect(readValues(fine, rule), String(error)).toEqual({ ok: true, values: { score: 81 } });
    }
  });

  it('reads no failure when the measure names no failure path', () => {
    expect(readValues(refused, { values: values.slice(0, 1) })).toEqual({
      ok: true,
      values: { score: 0 },
    });
  });
});
