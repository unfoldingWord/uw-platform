import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const exceptions = readFileSync('docs/exceptions.md', 'utf8').split('\n');
const prd = readFileSync('docs/PRD.md', 'utf8');

function rowsNaming(file: string): readonly string[] {
  return exceptions.filter((line) => line.startsWith('| 2026-11-25 |') && line.includes(file));
}

describe('the measures feature records the rules it bends and the issues it answers to', () => {
  it('records the MeasureRun steps that close a run without can()', () => {
    const rows = rowsNaming('apps/uw-platform/measures/workflow.ts');
    expect(rows.some((row) => row.includes('`finish`') && row.includes('`unwired`'))).toBe(true);
    expect(rows.some((row) => row.includes('apps/uw-platform/measures/run-measure.ts'))).toBe(true);
  });

  it('records the scheduled run acting as its activator without a request principal', () => {
    expect(rowsNaming('apps/uw-platform/measures/authority-of-run.ts')).toHaveLength(1);
  });

  it('names the dashboards design issue and leaves no placeholder', () => {
    expect(prd).not.toContain('#NNN');
    expect(prd).toMatch(
      /^Issue: #189 \(dashboards design\), #199, #200, #\w+\. Rules: ADR 0036\.$/m,
    );
  });
});
