import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const owner = 'packages/core/money.ts';

const formatterMarks = [
  /Intl\s*(?:\.\s*|\??\.?\s*\[\s*['"`])NumberFormat/,
  /\bNumberFormat\b/,
  /\.\s*toLocaleString\b/,
  /\.\s*toFixed\b/,
];

function scanned(path: string): boolean {
  return /^(apps|packages|sim)\//.test(path) && /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);
}

function offenders(files: ReadonlyMap<string, string>): string[] {
  return [...files]
    .filter(
      ([path, text]) =>
        path !== owner && scanned(path) && formatterMarks.some((mark) => mark.test(text)),
    )
    .map(([path]) => path);
}

describe('WB-11 Intl.NumberFormat appears only in packages/core/money.ts', () => {
  it('WB-11 no other non-test source under apps, packages or sim uses Intl.NumberFormat, toLocaleString or toFixed', () => {
    const files = new Map(repoFiles().map((path) => [path, readFileSync(path, 'utf8')]));
    expect(files.get(owner)).toMatch(/Intl\.NumberFormat/);
    expect(offenders(files)).toEqual([]);
  });

  it('flags a planted second formatter', () => {
    const planted = new Map([
      [owner, 'new Intl.NumberFormat()'],
      ['apps/uw-app/pages/spend.tsx', 'const f = new Intl.NumberFormat("en-US");'],
      ['packages/ui/components/x.ts', 'Intl . NumberFormat'],
      ['apps/uw-app/pages/spend.test.ts', 'new Intl.NumberFormat()'],
      ['apps/uw-app/pages/a.tsx', 'Intl["NumberFormat"]'],
      ['apps/uw-app/pages/b.tsx', 'const { NumberFormat } = Intl;'],
      ['packages/ui/components/c.tsx', '(1234.5).toLocaleString("en-US")'],
      ['sim/d.ts', 'total.toFixed(2)'],
      ['apps/uw-app/pages/fine.tsx', 'const money = formatMoney(m);'],
    ]);
    expect(offenders(planted)).toEqual([
      'apps/uw-app/pages/spend.tsx',
      'packages/ui/components/x.ts',
      'apps/uw-app/pages/a.tsx',
      'apps/uw-app/pages/b.tsx',
      'packages/ui/components/c.tsx',
      'sim/d.ts',
    ]);
  });
});
