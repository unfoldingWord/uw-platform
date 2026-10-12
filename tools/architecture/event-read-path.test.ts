import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const theReadPath = 'packages/db/store/events.ts';
const mayNameTheTable = new Set([
  theReadPath,
  'packages/db/schema.ts',
  'packages/db/store/rows.ts',
  'packages/db/test-seed.ts',
]);

const readsEvents = [
  /\.from\(\s*harnessEvents\b/,
  /\.from\(\s*\w+\.harnessEvents\b/,
  /Join\(\s*harnessEvents\b/,
  /Join\(\s*\w+\.harnessEvents\b/,
  /\.query\.harnessEvents\b/,
  /\b(?:FROM|JOIN)\s+"?harness_events\b/i,
  /\b(?:FROM|JOIN)\s+"?\w+"?\."?harness_events\b/i,
];

const schemaModules = ["@uw/db/schema'", "/schema'", '/schema.ts', '@uw/db/schema"', '/schema"'];

function isScanned(file: string): boolean {
  return (
    /\.(?:tsx?|m?js)$/.test(file) &&
    !/\.test\.(?:tsx?|m?js)$/.test(file) &&
    !file.includes('node_modules') &&
    !mayNameTheTable.has(file)
  );
}

function importsTheTable(source: string): boolean {
  return (
    schemaModules.some((module) => source.includes(module)) && /\bharnessEvents\b/.test(source)
  );
}

function selectsEvents(source: string): boolean {
  return readsEvents.some((pattern) => pattern.test(source)) || importsTheTable(source);
}

function readers(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(isScanned).filter((file) => selectsEvents(read(file)));
}

describe('KN-4 one read function is the only event read path', () => {
  it('finds no other file that selects from harness_events', () => {
    expect(readers(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it.each([
    'db.select().from(harnessEvents)',
    'tx.select().from(schema.harnessEvents)',
    'sql`SELECT * FROM harness_events`',
    'sql`SELECT * FROM public.harness_events`',
    'sql`SELECT * FROM "public"."harness_events"`',
    'sql`SELECT i.id FROM harness_items i JOIN harness_events e ON e.item_id = i.id`',
    'db.select().from(harnessItems).innerJoin(harnessEvents, on)',
    'db.select().from(harnessItems).leftJoin(schema.harnessEvents, on)',
    'await db.query.harnessEvents.findMany()',
    "import { harnessEvents as log } from '@uw/db/schema';\nawait db.select().from(log);",
    "import * as tables from '../../packages/db/schema.ts';\nconst t = tables.harnessEvents;",
  ])('flags %j', (source) => {
    expect(readers(['apps/uw-app/x.ts'], () => source)).toEqual(['apps/uw-app/x.ts']);
  });

  it.each(['apps/uw-app/x.js', 'apps/uw-app/x.mjs'])('scans %s', (file) => {
    expect(readers([file], () => 'db.select().from(harnessEvents)')).toEqual([file]);
  });

  it('leaves the gateway read through the transaction alone', () => {
    const gateway = 'await tx.harnessEvents.read.page({ harnessId, itemId, after, limit })';
    expect(readers(['packages/harness/items/x.ts'], () => gateway)).toEqual([]);
  });
});
