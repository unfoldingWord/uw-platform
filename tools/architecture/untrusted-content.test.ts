import { describe, expect, it } from 'vitest';
import { repoSources, type SourceFiles } from './agent-boundary.ts';
import {
  buildersTakingOutsideText,
  cachesWithoutClearance,
  forgedWrappers,
  promptBuilderFiles,
  promptFilesReadingDirectly,
  unwrappedBuilderCalls,
} from './untrusted-content.ts';

const real = repoSources();

function withPlanted(planted: Readonly<Record<string, string>>): SourceFiles {
  const texts = new Map(Object.entries(planted));
  const added = [...texts.keys()].filter((file) => !real.files.includes(file));
  return {
    files: [...real.files, ...added],
    read: (file) => texts.get(file) ?? real.read(file),
  };
}

const builderFile = 'apps/uw-app/runs/prompts.ts';
const bodies = 'apps/uw-app/runs/bodies.ts';
const promptSource = 'apps/uw-app/runs/prompt-source.ts';
const sneakCall = 'apps/uw-app/runs/sneak-review.ts';
const sneakBuilder = 'apps/uw-app/runs/sneak-prompts.ts';
const sneakCache = 'apps/uw-app/runs/verdict-cache.ts';

describe('UC-4 the tree passes the untrusted content check', () => {
  it('UC-4 finds the prompt builders where they are, and every one takes outside text wrapped', () => {
    expect(promptBuilderFiles(real)).toEqual([builderFile]);
    expect(buildersTakingOutsideText(real)).toEqual([]);
    expect(unwrappedBuilderCalls(real)).toEqual([]);
    expect(forgedWrappers(real)).toEqual([]);
  });

  it('UC-3 finds no file that builds a prompt reading pages, the schema or GitHub directly', () => {
    expect(promptFilesReadingDirectly(real)).toEqual([]);
  });

  it('UC-5 finds no cache of model output keyed without the reader clearance', () => {
    expect(cachesWithoutClearance(real)).toEqual([]);
  });
});

const unwrapped = [
  "import { workPrompt as build } from './prompts.ts';\nexport const p = build({ ...source, title: issue.title });",
  'export const p = reviewPrompt({ ...source, diff: (await deps.runKernel.runs.reviewDiff(host, runId)).diff });',
  'export const p = reviewPrompt({ ...source, diff: (await ports.githubFacts.diff(ref, range, 1)).text });',
  'export const p = workPrompt({ ...source, title: issue.title });',
  'export const p = workPrompt({ ...source, related: await db.select().from(ghReviews) });',
  "export const p = scoutPrompt({ ...source, context: await callCore(core, 'read_page', { pageId }) });",
  "export const p = workPrompt({ ...source, prompts: page.bodyMd.split(' ') });",
  'export const p = workPrompt({ ...source, prompts: review.findings });',
  'export const p = workPrompt({ ...source, prompts: await sql`select title from gh_issues` });',
];

const wrapped = [
  "export const p = reviewPrompt({ ...source, diff: untrusted({ source: 'pr_diff', itemId, text: (await ports.githubFacts.diff(ref, range, 1)).text }) });",
  "export const p = workPrompt({ ...source, title: untrusted({ source: 'issue_body', itemId, text: issue.title }) });",
  'export const p = workPrompt(promptSourceOf(read, item.itemId));',
  'const facts = await ports.githubFacts.pullRequest(ref);\nexport const p = workPrompt(source);',
];

describe('UC-4 the check fails on a planted call with an unwrapped outside read', () => {
  it.each(unwrapped)('flags %s', (text) => {
    expect(unwrappedBuilderCalls(withPlanted({ [sneakCall]: text }))).toEqual([
      expect.stringMatching(/^apps\/uw-app\/runs\/sneak-review\.ts: \w+Prompt$/),
    ]);
  });

  it.each(wrapped)('passes %s', (text) => {
    expect(unwrappedBuilderCalls(withPlanted({ [sneakCall]: text }))).toEqual([]);
  });
});

const leakyBuilders = [
  'export const sneakPrompt = (source: { readonly diff: string }): string => source.diff;',
  'export function sneakPrompt(source: { readonly diff: string }): string { return source.diff; }',
  "export function sneakPrompt(source: { readonly context?: string }): string { return source.context ?? ''; }",
  "export function sneakPrompt(source: { readonly reviewComments: readonly string[] }): string { return source.reviewComments.join(' '); }",
  "import { ghIssues } from '@uw/db/schema';\nexport function sneakPrompt(): string { return String(ghIssues); }",
  "import { readPage } from '../pages/store.ts';\nexport function sneakPrompt(): string { return String(readPage); }",
  'export function sneakPrompt(ports: { githubFacts: unknown }): string { return String(ports.githubFacts); }',
];

const cleanBuilder =
  "import { renderUntrusted, type UntrustedContent } from '@uw/harness';\nexport function sneakPrompt(source: { readonly diff: UntrustedContent }): string { return renderUntrusted(source.diff); }";

describe('UC-4 the check fails on a planted builder that takes outside text as a string', () => {
  it.each(leakyBuilders)('flags %s', (text) => {
    expect(buildersTakingOutsideText(withPlanted({ [sneakBuilder]: text }))).toEqual([
      sneakBuilder,
    ]);
  });

  it('passes a planted builder that takes the diff as untrusted content', () => {
    expect(buildersTakingOutsideText(withPlanted({ [sneakBuilder]: cleanBuilder }))).toEqual([]);
  });

  it('follows a planted builder to its planted unwrapped caller', () => {
    const planted = {
      [sneakBuilder]: cleanBuilder,
      [sneakCall]: 'export const p = sneakPrompt({ diff: ports.githubFacts });',
    };
    expect(unwrappedBuilderCalls(withPlanted(planted))).toEqual([`${sneakCall}: sneakPrompt`]);
  });
});

const forged = [
  "const wrapped = { source: 'pr_diff', itemId: null, text: diff } as UntrustedContent;",
  'const wrapped = <UntrustedContent>value;',
  "class UntrustedContent { readonly text = ''; }",
  "const wrapped = new UntrustedContent({ source: 'pr_diff', itemId: null, text: diff });",
  "const wrapped = new (known.constructor)({ source: 'pr_diff', itemId: null, text: diff });",
  "const Made = known.constructor as new (input: object) => object;\nconst wrapped = new Made({ source: 'pr_diff', itemId: null, text: diff });",
  "const wrapped = Reflect.construct(known.constructor, [{ source: 'pr_diff', itemId: null, text: diff }]);",
  "const wrapped = known.constructor({ source: 'pr_diff', itemId: null, text: diff });",
];

describe('UC-4 the check fails on a planted forgery of the wrapper', () => {
  it.each(forged)('flags %s in the app', (text) => {
    expect(forgedWrappers(withPlanted({ [sneakCall]: text }))).toEqual([sneakCall]);
  });

  it.each(forged)('flags %s in the kernel', (text) => {
    const file = 'packages/harness/runs/sneak.ts';
    expect(forgedWrappers(withPlanted({ [file]: text }))).toEqual([file]);
  });
});

describe('UC-3 the check fails on a planted prompt file that reads past the core client', () => {
  it('flags the run bodies importing the page store', () => {
    const planted = {
      [bodies]: `import { contextPages } from '../pages/context.ts';\n${real.read(bodies)}`,
    };
    expect(promptFilesReadingDirectly(withPlanted(planted))).toEqual([bodies]);
  });

  it('flags a file that imports the prompt builders and the database schema', () => {
    const text = `import { ghIssues } from '@uw/db/schema';\n${real.read(promptSource)}`;
    expect(promptFilesReadingDirectly(withPlanted({ [promptSource]: text }))).toEqual([
      promptSource,
    ]);
  });

  it('flags a planted file that calls a builder and imports GitHub facts', () => {
    const text =
      "import { openPullRequestFrom } from '../github/facts/queries.ts';\nexport const p = workPrompt(source);";
    expect(promptFilesReadingDirectly(withPlanted({ [sneakCall]: text }))).toEqual([sneakCall]);
  });

  it('passes the run bodies importing an engine type', () => {
    const planted = {
      [bodies]: `import type { Checkout } from '../engines/seam.ts';\n${real.read(bodies)}`,
    };
    expect(promptFilesReadingDirectly(withPlanted(planted))).toEqual([]);
  });
});

const modelCache =
  "import type { ModelDone } from './bodies.ts';\nconst verdictCache = new Map<string, ModelDone>();\nexport const remembered = (itemId: string) => verdictCache.get(itemId);";
const clearedCache =
  "import type { ModelDone } from './bodies.ts';\nimport { clearanceKey } from '@uw/harness';\nconst verdictCache = new Map<string, ModelDone>();\nexport const remembered = (reader: Principal, at: Date, itemId: string) => verdictCache.get(`${clearanceKey(reader, at)} ${itemId}`);";

describe('UC-5 the check fails on a planted cache of model output without the clearance key', () => {
  it('flags a planted cache of run verdicts keyed by item only', () => {
    expect(cachesWithoutClearance(withPlanted({ [sneakCache]: modelCache }))).toEqual([sneakCache]);
  });

  it('flags a planted cache of model turns in the kernel', () => {
    const file = 'packages/harness/runs/turn-cache.ts';
    const text =
      "import type { TurnResult } from '../ports.ts';\nexport const turnCache = new Map<string, TurnResult>();";
    expect(cachesWithoutClearance(withPlanted({ [file]: text }))).toEqual([file]);
  });

  it('passes a planted cache keyed by the clearance key', () => {
    expect(cachesWithoutClearance(withPlanted({ [sneakCache]: clearedCache }))).toEqual([]);
  });

  it('passes a planted testing helper, as it passes the step runner fake', () => {
    const file = 'apps/uw-app/testing/verdict-cache.ts';
    expect(cachesWithoutClearance(withPlanted({ [file]: modelCache }))).toEqual([]);
  });
});
