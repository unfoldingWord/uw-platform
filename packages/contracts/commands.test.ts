import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandNames, commandSchema, harnessCommandSchemas } from './commands.ts';
import { confirmPageCommandSchema } from './pages.ts';
import { platformCommandNameSchema } from './platform-commands.ts';

function validBody(name: string): Record<string, unknown> {
  const file = join(
    import.meta.dirname,
    'fixtures/command/valid',
    `${name.replaceAll('_', '-')}.json`,
  );
  return JSON.parse(readFileSync(file, 'utf8'));
}

function without(body: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));
}

const requestId = '00000000-0000-4000-8000-0000000000aa';
const itemId = '00000000-0000-4000-8000-0000000000bb';
const head = 'a'.repeat(40);

describe('WB-1 every control is a command with a requestId', () => {
  it('names a body schema for every command and no other', () => {
    expect(Object.keys(harnessCommandSchemas).sort()).toEqual([...commandNames].sort());
  });

  it('refuses each valid command body once its requestId is removed', () => {
    for (const name of commandNames) {
      const body = validBody(name);
      expect(commandSchema.safeParse(body).success, name).toBe(true);
      expect(commandSchema.safeParse(without(body, 'requestId')).success, name).toBe(false);
    }
  });
});

describe('command bodies', () => {
  it('refuses a field the command does not name', () => {
    expect(
      commandSchema.safeParse({ command: 'claim', requestId, itemId, delegationId: null }).success,
    ).toBe(false);
  });

  it('takes an import by repository and number, never a GitHub id', () => {
    const base = { command: 'import', requestId, repository: 'unfoldingWord/uw-platform' };
    expect(commandSchema.safeParse({ ...base, number: 7 }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, number: 7, githubId: 9 }).success).toBe(false);
  });

  it('needs a non-blank reason and the seen head on an override', () => {
    const base = { command: 'override', requestId, itemId, head };
    expect(commandSchema.safeParse({ ...base, reason: '  ' }).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, reason: 'reviewed by hand' }).success).toBe(true);
  });

  it('takes a pull request and its head together or neither on submit', () => {
    const base = { command: 'submit_to_gate', requestId, itemId, to: null };
    const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };
    expect(commandSchema.safeParse({ ...base, pullRequest, head }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, pullRequest: null, head: null }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, pullRequest, head: null }).success).toBe(false);
  });
});

describe('WB-2 reorder names the item to place before, never an index', () => {
  it('takes beforeItemId or null and refuses a position', () => {
    const base = { command: 'reorder', requestId, itemId };
    expect(commandSchema.safeParse({ ...base, beforeItemId: null }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, beforeItemId: itemId }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, position: 2 }).success).toBe(false);
  });
});

describe("#103 a workflow's stages change only through a draft", () => {
  const save = validBody('save_workflow_draft');
  const stage = (save['stages'] as Record<string, unknown>[])[0] ?? {};
  const withStage = (change: Record<string, unknown>) => ({
    ...save,
    stages: [{ ...stage, ...change }],
  });
  const many = (count: number) => Array.from({ length: count }, (_, n) => `v${n}`);

  it('no longer takes the four live stage commands', () => {
    for (const name of ['create_stage', 'update_stage', 'reorder_stages', 'remove_stage'])
      expect(commandNames).not.toContain(name);
  });

  it('saves a half-typed stage so the check can name what is wrong', () => {
    expect(commandSchema.safeParse(withStage({ title: '', wipLimit: 0 })).success).toBe(true);
  });

  it('caps validators, feeds, the stage count and the WIP limit on a save', () => {
    expect(commandSchema.safeParse(withStage({ validators: many(51) })).success).toBe(false);
    expect(commandSchema.safeParse(withStage({ feeds: many(51) })).success).toBe(false);
    expect(commandSchema.safeParse(withStage({ wipLimit: 1001 })).success).toBe(false);
    const fifty = { ...save, stages: Array.from({ length: 51 }, () => stage) };
    expect(commandSchema.safeParse(fifty).success).toBe(false);
  });

  it('never takes a paused flag or a position in a draft stage', () => {
    expect(commandSchema.safeParse(withStage({ paused: true })).success).toBe(false);
    expect(commandSchema.safeParse(withStage({ position: 10 })).success).toBe(false);
  });

  it('needs a reason to take over a draft and a revision to publish', () => {
    const takeOver = { command: 'take_over_workflow_draft', requestId };
    expect(commandSchema.safeParse({ ...takeOver, reason: ' ' }).success).toBe(false);
    expect(commandSchema.safeParse({ ...takeOver, reason: 'away' }).success).toBe(true);
    const publish = { command: 'publish_workflow_draft', requestId };
    expect(commandSchema.safeParse(publish).success).toBe(false);
    expect(commandSchema.safeParse({ ...publish, revision: 1 }).success).toBe(true);
  });
});

describe("#108 a stage's rules change live, never its shape", () => {
  const rules = validBody('set_stage_rules');
  const entry = (rules['stages'] as Record<string, unknown>[])[0] ?? {};
  const withEntry = (change: Record<string, unknown>) => ({
    ...rules,
    stages: [{ ...entry, ...change }],
  });

  it('takes the five rule fields for each named stage', () => {
    expect(commandSchema.safeParse(rules).success).toBe(true);
  });

  it('names at least one stage, each once', () => {
    expect(commandSchema.safeParse({ ...rules, stages: [] }).success).toBe(false);
    expect(commandSchema.safeParse({ ...rules, stages: [entry, entry] }).success).toBe(false);
  });

  it('never takes a title, phase, key, connector, loop or paused flag', () => {
    for (const change of [
      { title: 'Renamed' },
      { bracket: 'iterate' },
      { key: 'other' },
      { connector: 'merge_pr' },
      { feeds: [] },
      { paused: true },
    ])
      expect(commandSchema.safeParse(withEntry(change)).success).toBe(false);
  });

  it('keeps the in-progress limit at least 1', () => {
    expect(commandSchema.safeParse(withEntry({ wipLimit: 0 })).success).toBe(false);
  });
});

describe('hosted Builder is turned on through a command', () => {
  it('takes set_hosted_builder with a boolean enabled and nothing else', () => {
    const base = { command: 'set_hosted_builder', requestId };
    expect(commandSchema.safeParse({ ...base, enabled: true }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, enabled: false }).success).toBe(true);
    expect(commandSchema.safeParse(base).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, enabled: 'yes' }).success).toBe(false);
  });
});

describe('activation, measurement and confirmation bodies', () => {
  const pageId = '00000000-0000-4000-8000-0000000000cc';

  it('takes activate_persona with the page and the version the person saw, and nothing else', () => {
    const base = { command: 'activate_persona', requestId, pageId, expectedVersion: 1 };
    expect(commandSchema.safeParse(base).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, expectedVersion: 0 }).success).toBe(false);
    expect(commandSchema.safeParse(without(base, 'expectedVersion')).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, status: 'active' }).success).toBe(false);
  });

  it('refuses a record_measurement whose value is not finite', () => {
    const base = {
      command: 'record_measurement',
      requestId,
      itemId,
      source: 'manual',
      name: 'signups',
      value: 12,
      asOf: '2026-10-01',
    };
    expect(commandSchema.safeParse(base).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, value: Number.POSITIVE_INFINITY }).success).toBe(
      false,
    );
    expect(commandSchema.safeParse({ ...base, value: Number.NaN }).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, source: 'survey' }).success).toBe(false);
  });

  it('takes confirm_page with the page and the version the person read', () => {
    const base = { command: 'confirm_page', requestId, pageId, expectedVersion: 3 };
    expect(confirmPageCommandSchema.safeParse(base).success).toBe(true);
    expect(confirmPageCommandSchema.safeParse(without(base, 'expectedVersion')).success).toBe(
      false,
    );
    expect(platformCommandNameSchema.safeParse('confirm_page').success).toBe(true);
  });
});
