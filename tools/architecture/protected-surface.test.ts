import { domainOf } from '../../packages/harness/risk/derive.ts';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const surface = ['apps/uw-app/github/', 'apps/uw-app/ports/'];

function underSurface(): string[] {
  return repoFiles().filter((path) => surface.some((root) => path.startsWith(root)));
}

describe('KN-17 every file of the GitHub module and the platform adapters is protected', () => {
  it('finds the files it checks', () => {
    const files = underSurface();
    for (const root of surface) expect(files.some((path) => path.startsWith(root))).toBe(true);
  });

  it('classifies each one under a protected domain', () => {
    const unprotected = underSurface().filter((path) => domainOf(path) === null);
    expect(unprotected).toEqual([]);
  });
});
