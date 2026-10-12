import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemaRegistry } from './registry.ts';
import { verbIo } from './verb-io.ts';
import { FORBIDDEN_VERBS, verbNames, type VerbName } from './verb-names.ts';
import { findVerb, verbGrantSchema, verbManifest, verbRegistry } from './verbs.ts';

const fixtureRoot = join(import.meta.dirname, 'verb-fixtures');
type Side = 'input' | 'output';

function fixtures(verb: string, side: string, kind: string): unknown[] {
  const dir = join(fixtureRoot, verb, side, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')));
}

function judge(name: VerbName, side: Side): void {
  const schema = verbIo[name][side];
  const valid = fixtures(name, side, 'valid');
  const invalid = fixtures(name, side, 'invalid');
  expect(valid.length).toBeGreaterThan(0);
  expect(invalid.length).toBeGreaterThan(0);
  expect(valid.filter((value) => !schema.safeParse(value).success)).toEqual([]);
  expect(invalid.filter((value) => schema.safeParse(value).success)).toEqual([]);
}

function names(): string[] {
  return verbRegistry.map((entry) => entry.name);
}

function groupOf(name: string): string | undefined {
  return findVerb(name)?.group;
}

describe('CT-2 the verb registry', () => {
  it('registers exactly the thirteen verbs of PRD section 8.2', () => {
    expect(names()).toEqual([
      'search_pages',
      'read_page',
      'write_page',
      'resolve_context',
      'query_entities',
      'create_task',
      'list_gifts',
      'create_draft_journal_entry',
      'poll_queue',
      'claim_item',
      'submit_to_gate',
      'record_run_step',
      'get_health',
    ]);
    expect(names()).toEqual([...verbNames]);
  });

  it('exports the forbidden verbs and registers none of them', () => {
    expect([...FORBIDDEN_VERBS]).toEqual(['approve', 'merge', 'deploy', 'publish', 'advance']);
    expect(FORBIDDEN_VERBS.filter((name) => findVerb(name) !== undefined)).toEqual([]);
  });

  it('does not register resolve_policies under that name', () => {
    expect(findVerb('resolve_policies')).toBeUndefined();
  });

  it('serves every verb in v1 except the two role-gated ones', () => {
    const unserved = verbRegistry.filter((entry) => !entry.servedInV1).map((entry) => entry.name);
    expect(unserved).toEqual(['list_gifts', 'create_draft_journal_entry']);
  });

  it('declares every grant in a shape verbGrantSchema accepts', () => {
    const unparsed = verbRegistry
      .filter((entry) => entry.grant !== null && !verbGrantSchema.safeParse(entry.grant).success)
      .map((entry) => entry.name);
    expect(unparsed).toEqual([]);
  });

  it('groups the verbs as PRD section 8.2 does', () => {
    expect(groupOf('resolve_context')).toBe('pages_and_context');
    expect(groupOf('create_task')).toBe('records');
    expect(groupOf('list_gifts')).toBe('role_gated');
    expect(groupOf('get_health')).toBe('harness');
  });
});

describe('CT-2 the verb manifest is contract data', () => {
  it('is plain JSON-serialisable contract data', () => {
    const manifest = verbManifest();
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(manifest).toHaveLength(13);
  });

  it('serialises the registry with its Zod schemas stripped', () => {
    const stripped = verbRegistry.map((entry) => ({
      name: entry.name,
      group: entry.group,
      grant: entry.grant,
      servedInV1: entry.servedInV1,
    }));
    expect(JSON.parse(JSON.stringify(stripped))).toEqual(stripped);
  });

  it('names the two closed sets the lock must cover', () => {
    expect(Object.keys(schemaRegistry)).toEqual(
      expect.arrayContaining(['submit-to-gate-result', 'run-step']),
    );
  });
});

function summaryProblems(summary: string): string[] {
  const problems: string[] = [];
  if (summary.length === 0) problems.push('empty');
  if (summary.length > 200) problems.push('longer than 200 characters');
  if (summary.charAt(0) !== summary.charAt(0).toUpperCase()) problems.push('not sentence case');
  if (summary.includes('!')) problems.push('has an exclamation mark');
  return problems;
}

function allSummaryProblems(): string[] {
  return verbRegistry.flatMap((entry) => problemsOf(entry));
}

function problemsOf(entry: { name: string; summary: string }): string[] {
  return summaryProblems(entry.summary).map((problem) => `${entry.name}: ${problem}`);
}

describe('AB-1 every verb carries a summary a tool list can show', () => {
  it('gives every verb a plain sentence-case summary of at most 200 characters', () => {
    expect(allSummaryProblems()).toEqual([]);
  });

  it('words claim_item as the registry promises', () => {
    expect(findVerb('claim_item')?.summary).toBe(
      "Claim an item; an agent's claim takes a 15-minute lease. An unattended runner names its delegation.",
    );
  });

  it('serialises every summary in the manifest', () => {
    const manifest = verbManifest();
    expect(manifest.map((entry) => entry.summary)).toEqual(
      verbRegistry.map((entry) => entry.summary),
    );
    expect(manifest.every((entry) => entry.summary.length > 0)).toBe(true);
  });
});

describe.each(verbNames)('CT-2 %s fixtures', (name) => {
  it('judges input fixtures correctly', () => {
    judge(name, 'input');
  });

  it('judges output fixtures correctly', () => {
    judge(name, 'output');
  });
});

describe('submit_to_gate attachments', () => {
  const input = verbIo.submit_to_gate.input;
  const base = {
    itemId: '00000000-0000-4000-8000-000000000002',
    evidence: {},
    to: null,
    pullRequest: null,
    head: null,
  };
  const pages = Array.from(
    { length: 11 },
    (_, index) => `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
  );

  it('may attach up to ten distinct pages and defaults to none', () => {
    expect(input.parse(base).attach).toEqual([]);
    expect(input.safeParse({ ...base, attach: pages.slice(0, 10) }).success).toBe(true);
    expect(input.safeParse({ ...base, attach: pages }).success).toBe(false);
    expect(input.safeParse({ ...base, attach: [pages[0], pages[0]] }).success).toBe(false);
    expect(input.safeParse({ ...base, attach: ['not-a-page'] }).success).toBe(false);
  });
});
