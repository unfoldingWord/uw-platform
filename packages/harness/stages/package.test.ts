import { describe, expect, it } from 'vitest';
import { checkOnly } from '../templates/check-only.ts';
import { software } from '../templates/software.ts';
import { hasPackageStage } from './package.ts';

describe('GL-2 a check-only harness has no Package stage', () => {
  it('finds the Package stage on the software template and none on the check-only one', () => {
    expect(hasPackageStage(software.stages)).toBe(true);
    expect(hasPackageStage(checkOnly.stages)).toBe(false);
  });
});
