import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const owner = 'packages/core/money.ts';

function scanned(path: string): boolean {
  return /^(apps|packages|sim)\//.test(path) && /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);
}

function offenders(files: ReadonlyMap<string, string>): string[] {
  return [...files]
    .filter(
      ([path, text]) => path !== owner && scanned(path) && /Intl\s*\.\s*NumberFormat/.test(text),
    )
    .map(([path]) => path);
}

describe('WB-11 Intl.NumberFormat appears only in packages/core/money.ts', () => {
  it('WB-11 no other non-test source under apps, packages or sim uses it', () => {
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
    ]);
    expect(offenders(planted)).toEqual([
      'apps/uw-app/pages/spend.tsx',
      'packages/ui/components/x.ts',
    ]);
  });
});
