import { describe, expect, it } from 'vitest';
import { verbIo } from '@uw/contracts';
import { outlineOf } from './raw-outline.ts';

const audit = {
  score: 81,
  band: 'good',
  indexed: true,
  missing: null,
  meta: { 'scoring/version': '2' },
  recommendations: ['Add an llms.txt', 'Describe images'],
  checks: [
    { name: 'robots', passed: true },
    { name: 'sitemap', passed: false },
  ],
};

describe("outlining a tool's JSON output as pointers an agent can name", () => {
  it('lists each scalar leaf and each list of text with its pointer and a sample', () => {
    expect(outlineOf(JSON.stringify(audit), 50)).toEqual({
      leaves: [
        { path: '/score', type: 'number', sample: 81 },
        { path: '/band', type: 'text', sample: 'good' },
        { path: '/indexed', type: 'yes_no', sample: true },
        { path: '/missing', type: null, sample: null },
        { path: '/meta/scoring~1version', type: 'text', sample: '2' },
        { path: '/recommendations', type: 'text_list', sample: 'Add an llms.txt' },
        { path: '/checks/0/name', type: 'text', sample: 'robots' },
        { path: '/checks/0/passed', type: 'yes_no', sample: true },
        { path: '/checks/1/name', type: 'text', sample: 'sitemap' },
        { path: '/checks/1/passed', type: 'yes_no', sample: false },
      ],
      more: false,
    });
  });

  it('stops at the cap and says there is more, without cutting the document', () => {
    const many = JSON.stringify({ items: Array.from({ length: 500 }, (_, n) => ({ n })) });
    const outline = outlineOf(many, 20);
    expect(outline?.leaves).toHaveLength(20);
    expect(outline?.more).toBe(true);
  });

  it('shortens a long sample and answers null for output that is not JSON', () => {
    const long = outlineOf(JSON.stringify({ text: 'x'.repeat(500) }), 5);
    expect(String(long?.leaves[0]?.sample).length).toBeLessThanOrEqual(80);
    expect(outlineOf('Traceback (most recent call last)', 5)).toBeNull();
  });

  it('keeps a sample of emoji within the reply limit, without splitting one', () => {
    const outline = outlineOf(JSON.stringify({ text: '\u{1F600}'.repeat(60) }), 5);
    const sample = String(outline?.leaves[0]?.sample);
    expect(sample.length).toBeLessThanOrEqual(80);
    expect(sample.endsWith('\u{1F600}…')).toBe(true);
    expect(() => encodeURIComponent(sample)).not.toThrow();
    const reply = verbIo.read_measure_run.output.shape.observations.element.shape.outline;
    expect(reply.safeParse(outline?.leaves).success).toBe(true);
  });

  it('keeps a sample of exactly the limit whole', () => {
    const outline = outlineOf(JSON.stringify({ text: 'x'.repeat(80) }), 5);
    expect(outline?.leaves[0]?.sample).toBe('x'.repeat(80));
  });
});
