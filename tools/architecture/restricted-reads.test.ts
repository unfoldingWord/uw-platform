import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifiedTables, tableEntries } from '../../packages/db/declarations.ts';
import * as schema from '../../packages/db/schema.ts';
import { repoFiles } from '../repo-files.ts';
import { restrictedReads, type ReadGovernance } from './restricted-reads.ts';

type Table = { readonly table: string; readonly exportName: string };

const closed: ReadonlySet<string> = new Set(['restricted', 'sensitive']);
const closedNames = new Set(
  classifiedTables(schema)
    .filter((entry) => closed.has(entry.classification))
    .map((entry) => entry.table),
);
const tables: readonly Table[] = tableEntries(schema).filter((entry) =>
  closedNames.has(entry.table),
);

const notScanned = [
  'node_modules',
  'packages/db/schema',
  'packages/db/migrations/',
  'packages/db/test-',
  'packages/db/fixtures/',
  'packages/harness/port-contracts/',
  '/testing/',
  'sim/',
  'tools/',
];

function isScanned(file: string): boolean {
  return (
    /\.(?:tsx?|m?js)$/.test(file) &&
    !/\.test\.(?:tsx?|m?js)$/.test(file) &&
    !notScanned.some((part) => file.startsWith(part) || file.includes(part))
  );
}

const exportNames = new Set(tables.map((entry) => entry.exportName));
const tableNames = new Set(tables.map((entry) => entry.table));

const byExportName = [
  /\.from\(\s*([\w.]+)/g,
  /Join\(\s*([\w.]+)/g,
  /\.query\.(\w+)/g,
  /\.(\w+)\.read\b/g,
];
const byTableName = /\b(?:FROM|JOIN)\s+([\w".]+)/gi;

function names(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map(
    (match) => (match[1] ?? '').replaceAll('"', '').split('.').at(-1) ?? '',
  );
}

function reads(source: string): boolean {
  return (
    byExportName.some((pattern) => names(source, pattern).some((name) => exportNames.has(name))) ||
    names(source, byTableName).some((name) => tableNames.has(name))
  );
}

function readers(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(isScanned).filter((file) => reads(read(file)));
}

function governanceOf(
  ledger: ReadonlyMap<string, ReadGovernance>,
  file: string,
): ReadGovernance | null {
  const exact = ledger.get(file);
  if (exact !== undefined) return exact;
  const folders = [...ledger.keys()].filter((key) => key.endsWith('/') && file.startsWith(key));
  const nearest = folders.sort((a, b) => b.length - a.length)[0];
  return nearest === undefined ? null : (ledger.get(nearest) ?? null);
}

const appliesTheRule =
  /kind: 'row'|\breadsDelegation\(|\breadableDelegations\(|\breadableRoutines\(/;

const source = (file: string): string => readFileSync(file, 'utf8');

function stillRead(found: readonly string[], key: string): boolean {
  return key.endsWith('/') ? found.some((file) => file.startsWith(key)) : found.includes(key);
}

function unapplied([, governance]: readonly [string, ReadGovernance]): boolean {
  return governance.how === 'rule' && !appliesTheRule.test(source(governance.appliedIn));
}

describe('#155 every read of a restricted or sensitive table is accounted for', () => {
  const found = readers(repoFiles(), source);

  it('finds restricted tables to guard', () => {
    expect(tables.length).toBeGreaterThan(0);
    expect(found.length).toBeGreaterThan(0);
  });

  it('finds no file that reads such a table and is missing from the ledger', () => {
    expect(found.filter((file) => governanceOf(restrictedReads, file) === null)).toEqual([]);
  });

  it('holds no ledger entry for a file that no longer reads such a table', () => {
    expect([...restrictedReads.keys()].filter((key) => !stillRead(found, key))).toEqual([]);
  });

  it('finds the declared row rule applied wherever a ledger entry says it is', () => {
    expect([...restrictedReads].filter(unapplied).map(([file]) => file)).toEqual([]);
  });
});

describe('#155 the scan for reads of a restricted or sensitive table', () => {
  it.each([
    'db.select().from(roleGrants)',
    'tx.select().from(schema.grantAudit)',
    'db.select().from(people).innerJoin(serviceTokens, on)',
    'sql`SELECT 1 FROM role_grants g`',
    'sql`SELECT 1 FROM "public"."push_subscriptions"`',
    'await tx.delegations.read.byId(id)',
    'const { read } = scope.tx.gateDecisions;\nawait scope.tx.gateDecisions.read.forItem(id)',
    'await db.query.routines.findMany()',
  ])('flags %j', (text) => {
    expect(readers(['apps/uw-app/x.ts'], () => text)).toEqual(['apps/uw-app/x.ts']);
  });

  it('leaves a read of an internal table and a write of a restricted one alone', () => {
    expect(readers(['apps/uw-app/x.ts'], () => 'db.select().from(harnesses)')).toEqual([]);
    expect(
      readers(['apps/uw-app/x.ts'], () => 'await tx.delegations.write.revoke(id, at)'),
    ).toEqual([]);
  });

  it('prefers the entry for a file over the entry for its folder', () => {
    const ledger = new Map<string, ReadGovernance>([
      ['packages/harness/delegations/', { how: 'platform' }],
      ['packages/harness/delegations/commands.ts', { how: 'derived' }],
    ]);
    expect(governanceOf(ledger, 'packages/harness/delegations/commands.ts')).toEqual({
      how: 'derived',
    });
    expect(governanceOf(ledger, 'packages/harness/delegations/live.ts')).toEqual({
      how: 'platform',
    });
    expect(governanceOf(ledger, 'apps/uw-app/x.ts')).toBeNull();
  });
});
