import {
  isForbiddenVerbName,
  personaFrontmatterSchema,
  verbRegistry,
  type Identity,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { dryRun } from '../personas/dry-run.ts';
import { personaPageDraft, templatePersonas, type PersonaFixture } from './personas.ts';

const harness = { id: '00000000-0000-4000-8000-000000009301', jdArea: '80-89' } as const;
const owner = 'human:00000000-0000-4000-8000-000000000001' as Identity;
const served = verbRegistry.filter((verb) => verb.servedInV1).map((verb) => verb.name);

function fixture(template: 'software' | 'bml', slug: string): PersonaFixture {
  const found = templatePersonas[template].find((entry) => entry.slug === slug);
  if (found === undefined) throw new Error(`no ${slug} in ${template}`);
  return found;
}

function builderIsAPage(): void {
  const builder = fixture('software', 'builder');
  const hosted = fixture('software', 'builder-hosted');
  expect(builder.toolset).toHaveLength(11);
  expect(builder.toolset.every((verb) => served.includes(verb))).toBe(true);
  expect([builder.run_shape, builder.engine]).toEqual(['external-run', 'external']);
  expect([hosted.run_shape, hosted.engine]).toEqual(['workflow-run', 'claude-code-sandbox']);
  expect(hosted.toolset).toEqual(builder.toolset);
  expect(personaPageDraft(builder, harness, owner)).toMatchObject({
    slug: 'persona-builder',
    frontmatter: { identity: 'agent:builder', owner, harness: harness.id, capability: 'build' },
  });
}

function reviewerHasNoGate(): void {
  const reviewer = fixture('software', 'reviewer');
  const second = fixture('software', 'reviewer-codex');
  for (const persona of [reviewer, second]) {
    expect(persona.toolset).not.toContain('write_page');
    expect(persona.toolset.filter(isForbiddenVerbName)).toEqual([]);
    expect(persona.capability).toBe('review');
  }
  expect(reviewer.engine).toBe('openrouter-messages');
  expect(second.engine).toBe('codex-sandbox');
  expect(second.provider).not.toBe(reviewer.provider);
}

function iterateIsAPage(): void {
  const [iterate, ...others] = templatePersonas.bml;
  expect(others).toEqual([]);
  expect(iterate).toMatchObject({
    slug: 'iterate',
    engine: 'openrouter-messages',
    run_shape: 'workflow-run',
    capability: 'iterate',
  });
  expect(iterate?.toolset).toContain('query_entities');
  expect(iterate?.toolset.filter((verb) => verb.includes('measurement'))).toEqual([]);
  expect(iterate?.bodyMd).toContain('measurements_for_item');
}

async function everyPersonaDryRuns(): Promise<void> {
  const all = [...templatePersonas.software, ...templatePersonas.bml];
  expect(all.map((persona) => persona.slug)).toEqual([
    'builder',
    'builder-hosted',
    'reviewer',
    'reviewer-codex',
    'iterate',
  ]);
  for (const persona of all) {
    const draft = personaPageDraft(persona, harness, owner);
    const frontmatter = personaFrontmatterSchema.parse(draft.frontmatter);
    const identity = frontmatter.identity;
    expect(await dryRun({ identity, frontmatter, body: draft.bodyMd })).toBeNull();
  }
}

describe('template personas', () => {
  it(
    'PE-5 Builder is a persona page in the software fixture: its toolset is the eleven served verbs, external-run by default and workflow-run on claude-code-sandbox',
    builderIsAPage,
  );
  it(
    "PE-6 Reviewer's toolset has no gate verb and no write_page, and its default engine is openrouter-messages; the second Reviewer is on codex-sandbox",
    reviewerHasNoGate,
  );
  it(
    'PE-7 Iterate is a persona page in the BML fixture on openrouter-messages and workflow-run, reading measurements only through query_entities',
    iterateIsAPage,
  );
  it(
    'PE-5 every fixture persona passes the frontmatter schema and the dry run',
    everyPersonaDryRuns,
  );
});
