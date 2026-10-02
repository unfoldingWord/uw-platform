import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const composition = ['sim/', 'apps/uw-app/cron/'];

const named = new Set([
  'packages/contracts/identity.ts',
  'packages/core/principal.ts',
  'packages/core/principal.test.ts',
  'packages/harness/access.ts',
  'tools/architecture/system-principal.test.ts',
]);

const mentions = [
  /\bsystemPrincipal\b/,
  /\bsystemIdentity\b/,
  /['"`]agent:system['"`]/,
  /agent:\$\{\s*['"`]system['"`]\s*\}/,
  /['"`]agent:['"`]\s*\+\s*['"`]system['"`]/,
  /['"`]agent:sys['"`]\s*\+/,
];

function isSource(file: string): boolean {
  return /\.(?:tsx?|m?js)$/.test(file) && !file.includes('node_modules');
}

function allowed(file: string): boolean {
  return (
    named.has(file) ||
    composition.some((root) => file.startsWith(root)) ||
    (file.startsWith('apps/') && /\.test\.tsx?$/.test(file))
  );
}

function minters(files: readonly string[], read: (file: string) => string): string[] {
  return files
    .filter((file) => isSource(file) && !allowed(file))
    .filter((file) => mentions.some((pattern) => pattern.test(read(file))));
}

describe('only the composition roots construct the system principal', () => {
  it('finds no other file that names it', () => {
    expect(minters(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it.each([
    ['packages/harness/items/sweep.ts', 'const actor = systemPrincipal();'],
    [
      'apps/uw-ingest/receive.ts',
      "principalSchema.parse({ identity: systemIdentity, kind: 'agent' })",
    ],
    ['packages/harness/gates/x.mjs', "const identity = 'agent:system';"],
    ['apps/uw-app/mcp/server.ts', 'const actor = systemPrincipal();'],
    ['apps/uw-app/x.ts', 'const id = `agent:${"system"}`;'],
    ['packages/harness/y.ts', "const id = 'agent:' + 'system';"],
  ])('flags %s', (file, source) => {
    expect(minters([file], () => source)).toEqual([file]);
  });

  it.each([
    [
      'apps/uw-app/cron/lease-sweep.ts',
      'kernel.items.expireLeases({ actor: systemPrincipal(), traceId })',
    ],
    ['apps/uw-app/harness/claims.pg.test.ts', 'systemPrincipal()'],
    ['sim/fixtures.ts', 'principalSchema.parse({ identity: systemIdentity })'],
  ])('allows %s', (file, source) => {
    expect(minters([file], () => source)).toEqual([]);
  });
});
