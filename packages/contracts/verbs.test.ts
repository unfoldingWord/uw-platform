import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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

const measureVerbs = [
  'save_measure',
  'save_dashboard',
  'run_measure',
  'read_measure_run',
  'read_metric',
  'read_observations',
  'preview_dashboard',
];

const measureAndChartVerbs = [...measureVerbs, 'render_chart'];

function names(): string[] {
  return verbRegistry.map((entry) => entry.name);
}

function groupOf(name: string): string | undefined {
  return findVerb(name)?.group;
}

describe('CT-2 the verb registry', () => {
  it('registers the thirteen verbs of PRD section 8.2, attach_file, render_pdf, the four collection verbs, the seven measure verbs and render_chart', () => {
    expect(names()).toEqual([
      'search_pages',
      'read_page',
      'write_page',
      'attach_file',
      'render_pdf',
      'resolve_context',
      'query_entities',
      'create_task',
      'read_collection',
      'read_view',
      'create_row',
      'set_property',
      'list_gifts',
      'create_draft_journal_entry',
      'poll_queue',
      'claim_item',
      'submit_to_gate',
      'record_run_step',
      'get_health',
      ...measureAndChartVerbs,
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

  it('serves every verb in v1 except the two role-gated ones and the measure verbs not yet handled', () => {
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

describe('#198 render_pdf in the verb registry', () => {
  it('#198 registers render_pdf as a viewer verb on pages and context', () => {
    expect(findVerb('render_pdf')?.group).toBe('pages_and_context');
    expect(findVerb('render_pdf')?.grant).toEqual({ scope: 'resource_area', role: 'viewer' });
  });

  it('#198 gives render_pdf no field that could name a recipient or a destination', () => {
    const target = { kind: 'page', pageId: '00000000-0000-4000-8000-000000000001' };
    const input = verbIo.render_pdf.input;
    expect(input.safeParse({ target }).success).toBe(true);
    for (const field of ['recipient', 'url', 'email', 'to']) {
      expect(input.safeParse({ target, [field]: 'someone@example.org' }).success).toBe(false);
    }
  });
});

describe('ADR 0036 the measure verbs in the verb registry', () => {
  it('ADR 0036 lets an editor save and run a measure, and a viewer read and preview', () => {
    const grants = measureVerbs.map((name) => [name, findVerb(name)?.grant?.role]);
    expect(grants).toEqual([
      ['save_measure', 'editor'],
      ['save_dashboard', 'editor'],
      ['run_measure', 'editor'],
      ['read_measure_run', 'viewer'],
      ['read_metric', 'viewer'],
      ['read_observations', 'viewer'],
      ['preview_dashboard', 'viewer'],
    ]);
  });

  it('ADR 0036 has no verb that starts a trial, activates or makes a dashboard active', () => {
    const words = verbRegistry.filter((entry) => /trial|activat/.test(entry.name));
    expect(words).toEqual([]);
  });

  it('ADR 0036 gives run_measure no field that could name a tool, a command or a host', () => {
    const input = verbIo.run_measure.input;
    const measureId = '00000000-0000-4000-8000-000000000001';
    expect(input.safeParse({ measureId }).success).toBe(true);
    for (const field of ['package', 'command', 'address', 'host', 'kind']) {
      expect(input.safeParse({ measureId, [field]: 'x' }).success).toBe(false);
    }
  });

  it('ADR 0036 saves a measure from typed fields, never from frontmatter the agent writes', () => {
    const input = verbIo.save_measure.input;
    const fields = Object.keys(z.toJSONSchema(input).properties ?? {});
    expect(fields).toContain('measure');
    expect(fields).not.toContain('frontmatter');
  });
});

describe('#199 render_chart in the verb registry', () => {
  it('#199 lets a viewer draw a chart, under the read of the workflow its query reads', () => {
    expect(findVerb('render_chart')?.group).toBe('records');
    expect(findVerb('render_chart')?.grant).toEqual({ scope: 'resource_area', role: 'viewer' });
  });

  it('#199 offers the agent a typed object, so its tool schema is an object', () => {
    expect(z.toJSONSchema(verbIo.render_chart.input)).toMatchObject({ type: 'object' });
  });
});

describe('CT-2 the verb manifest is contract data', () => {
  it('is plain JSON-serialisable contract data', () => {
    const manifest = verbManifest();
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(manifest).toHaveLength(27);
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
