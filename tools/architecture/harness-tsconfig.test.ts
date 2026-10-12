import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const harness = join(process.cwd(), 'packages/harness');
const probe = join(harness, 'workers-global-probe.ts');

function typecheck(): { failed: boolean; output: string } {
  try {
    execFileSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', join(harness, 'tsconfig.json')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { failed: false, output: '' };
  } catch (error) {
    return { failed: true, output: String((error as { stdout?: string }).stdout) };
  }
}

afterEach(() => {
  rmSync(probe, { force: true });
});

describe('the packages/harness tsconfig', () => {
  it('typechecks the package as it stands', () => {
    expect(typecheck().failed).toBe(false);
  }, 120_000);

  it('refuses a Workers global', () => {
    writeFileSync(probe, 'export const cache = caches.default;\n');
    const { failed, output } = typecheck();
    expect(failed).toBe(true);
    expect(output).toContain("Cannot find name 'caches'");
  }, 120_000);
});
