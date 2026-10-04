import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { islandsJs, islandsPath, serviceWorkerJs } from '../../apps/uw-app/generated/islands.ts';

describe('the islands bundle', () => {
  it('the committed islands bundle and service worker are the current build', () => {
    expect(() =>
      execFileSync('node', ['tools/ui/build-islands.ts', '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
    const hash = createHash('sha256').update(islandsJs).digest('hex').slice(0, 12);
    expect(islandsPath).toBe(`/assets/islands-${hash}.js`);
  }, 120_000);

  it('names no kernel or database module and carries no comment', () => {
    for (const built of [islandsJs, serviceWorkerJs]) {
      expect(built).not.toMatch(/@uw\/(?:harness|db)\b|packages\/(?:harness|db)\//);
      expect(built).not.toMatch(/\/\*|^\s*\/\/|[^:]\/\/\s/m);
    }
  });

  it('leaves the shell asset list to the route, so a stylesheet change never stales the bundle', () => {
    expect(serviceWorkerJs).toContain('UW_SHELL_ASSETS');
    expect(serviceWorkerJs).not.toMatch(/\/assets\/app-[0-9a-f]{12}\.css/);
  });
});
