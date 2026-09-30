import { describe, expect, it } from 'vitest';
import { findDateViolations, isScanned } from './date-grep.ts';

describe('the date grep', () => {
  it.each([
    'new Date().toLocaleDateString()',
    'amount.toLocaleString()',
    'new Intl.DateTimeFormat("en-US")',
    'when.toISOString().slice(0, 10)',
    "format(when, 'yyyy-MM-dd')",
    "format(when, 'DD/MM/YYYY')",
  ])('flags %j', (line) => {
    expect(findDateViolations('apps/uw-app/page.ts', line)).toEqual([
      { path: 'apps/uw-app/page.ts', line: 1, text: line },
    ]);
  });

  it.each(['formatDate(new Date())', 'when.toISOString()', "const due = '2026-03-03';"])(
    'passes %j',
    (line) => {
      expect(findDateViolations('apps/uw-app/page.ts', line)).toEqual([]);
    },
  );

  it('reports the line number of each violation', () => {
    const source = 'const a = 1;\nwhen.toLocaleDateString();\n';
    expect(findDateViolations('x.ts', source).map((found) => found.line)).toEqual([2]);
  });

  it('exempts only the dates module and the patterns it is built from', () => {
    expect(isScanned('packages/core/dates.ts')).toBe(false);
    expect(isScanned('tools/lint/date-patterns.ts')).toBe(false);
    expect(isScanned('packages/core/dates.test.ts')).toBe(true);
    expect(isScanned('packages/core/other.ts')).toBe(true);
    expect(isScanned('apps/uw-app/island.tsx')).toBe(true);
    expect(isScanned('tools/lint/check-dates.ts')).toBe(true);
  });

  it('scans code, not prose or markup', () => {
    expect(isScanned('docs/architecture.md')).toBe(false);
    expect(isScanned('ui-design/Home.dc.html')).toBe(false);
  });
});
