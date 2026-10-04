import { describe, expect, it } from 'vitest';
import { isGeneratedArtefact, repoFiles } from './repo-files.ts';

describe('the repository file list the source scanners read', () => {
  it('leaves out the built islands bundle, whose sources are scanned instead', () => {
    expect(isGeneratedArtefact('apps/uw-app/generated/islands.ts')).toBe(true);
    expect(isGeneratedArtefact('apps/uw-app/islands/browser/main.ts')).toBe(false);
    expect(isGeneratedArtefact('packages/ui/generated/app-css.ts')).toBe(false);
    const files = repoFiles();
    expect(files).toContain('apps/uw-app/islands/worker/sw.ts');
    expect(files.filter(isGeneratedArtefact)).toEqual([]);
  });
});
