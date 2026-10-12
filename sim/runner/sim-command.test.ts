import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { simCommand } from './sim-command.ts';

const fixturesRoot = fileURLToPath(new URL('./fixtures/', import.meta.url));
const failingScenario =
  "export const scenario = { id: 'ZZ-5', title: 'fails on purpose', run: async () => { throw new Error('planted failure'); } };";

function plantFailingScenario(): string {
  mkdirSync(fixturesRoot, { recursive: true });
  const directory = mkdtempSync(join(fixturesRoot, 'uw-sim-command-'));
  writeFileSync(join(directory, 'ZZ-5.fails.ts'), failingScenario);
  return directory;
}

const directory = plantFailingScenario();

afterAll(async () => {
  rmSync(directory, { recursive: true, force: true });
  await closeEmbeddedTemplate();
});

describe('DX-4 a failing scenario fails the sim command', () => {
  it('prints the failure and the count, and returns exit status 1', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const status = await simCommand(['--', 'all'], directory, {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    });
    expect(status).toBe(1);
    expect(err).toEqual([]);
    expect(out.join('')).toContain(
      'scenario ZZ-5.fails: fails on purpose\nresult: fail: planted failure',
    );
    expect(out.join('')).toContain('0 of 1 scenarios passed\n');
  }, 60_000);
});
