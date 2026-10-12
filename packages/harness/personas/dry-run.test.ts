import { describe, expect, it } from 'vitest';
import { personaFrontmatterSchema, type Identity } from '@uw/contracts';
import type { TurnRequest, TurnResult } from '../ports.ts';
import { dryRun, FIXTURE_ITEM_PROMPT, type DryRunPersona } from './dry-run.ts';
import { parseAgentSkillHeader } from './instructions.ts';

const body = [
  '---',
  'name: iterate',
  'description: Reads the measurements and drafts a labelled revision.',
  '---',
  'Read the measurements through query_entities, then draft a revision.',
].join('\n');

const frontmatter = personaFrontmatterSchema.parse({
  identity: 'agent:iterate',
  owner: 'human:00000000-0000-4000-8000-000000000001',
  harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  toolset: ['read_page', 'query_entities'],
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'z-ai/glm-5.3',
  provider: 'z-ai',
  budget: { monthly_minor: 5000, currency: 'USD' },
  capability: 'build',
});

function persona(change: Partial<typeof frontmatter> = {}, text = body): DryRunPersona {
  return {
    identity: (change.identity ?? frontmatter.identity) as Identity,
    frontmatter: { ...frontmatter, ...change },
    body: text,
  };
}

const ended: TurnResult = {
  toolCalls: [],
  text: 'done',
  stopReason: 'end_turn',
  usage: { inputTokens: 0, outputTokens: 0, costMicros: 0, costBasis: 'metered' },
  resolvedProvider: 'z-ai',
  resolvedModel: 'z-ai/glm-5.3',
};

describe('the agentskills header', () => {
  it('reads the name, the description and the body after it', () => {
    expect(parseAgentSkillHeader(body)).toEqual({
      name: 'iterate',
      description: 'Reads the measurements and drafts a labelled revision.',
      body: 'Read the measurements through query_entities, then draft a revision.',
    });
  });

  it.each([
    ['Plain instructions.', 'no agentskills header'],
    ['---\nname: iterate\n', 'no agentskills header'],
    ['---\n- a\n- b\n---\nBody.', 'the header is not a mapping'],
    ['---\ndescription: d\n---\nBody.', 'the header has no name'],
    ['---\nname: Iterate\ndescription: d\n---\nBody.', 'the header has no name'],
    ['---\nname: iterate\n---\nBody.', "the header's description is missing or too long"],
    [
      `---\nname: iterate\ndescription: ${'d'.repeat(1025)}\n---\nBody.`,
      "the header's description is missing or too long",
    ],
    ['---\nname: iterate\ndescription: d\nmodel: x\n---\nBody.', 'the header names model'],
    ['---\nname: iterate\ndescription: d\n---\n  \n', 'the body is empty'],
    ['---\nname: iterate\nname: other\ndescription: d\n---\nBody.', 'the header is not a mapping'],
  ])('finds the problem in %j', (text, problem) => {
    expect(parseAgentSkillHeader(text)).toEqual({ problem });
  });

  it('allows the other agentskills keys', () => {
    const text =
      '---\nname: iterate\ndescription: d\nlicense: MIT\nallowed-tools: read_page\n---\nBody.';
    expect(parseAgentSkillHeader(text)).toMatchObject({ name: 'iterate', body: 'Body.' });
  });
});

describe('the dry run', () => {
  it('PE-3 the dry run passes a persona whose instructions are an agentskills document and whose engine hosts its run shape', async () => {
    expect(await dryRun(persona())).toBeNull();
    expect(await dryRun(persona({ engine: 'claude-messages', provider: null }))).toBeNull();
  });

  it('PE-3 the dry run names the first problem: header, name, engine, provider, review with write_page', async () => {
    const problems = await Promise.all([
      dryRun(persona({}, 'Plain instructions.')),
      dryRun(persona({ identity: 'agent:iterate-two' as Identity })),
      dryRun(persona({ engine: 'external' })),
      dryRun(persona({ provider: null })),
      dryRun(persona({ capability: 'review', toolset: ['read_page', 'write_page'] })),
    ]);
    expect(problems).toEqual([
      {
        message:
          'persona iterate instructions are not an agentskills document: no agentskills header',
      },
      { message: 'persona iterate-two instructions are named iterate' },
      { message: 'persona iterate runs workflow-run on external, which cannot host it' },
      { message: 'persona iterate names no provider for openrouter-messages' },
      { message: 'persona iterate reviews and may not hold write_page' },
    ]);
  });
});

describe('the dry run turn', () => {
  it('PE-3 the dry run runs one turn and calls no tool', async () => {
    const requests: TurnRequest[] = [];
    const once = async (request: TurnRequest) => {
      requests.push(request);
      return ended;
    };
    expect(await dryRun(persona(), once)).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      engine: 'openrouter-messages',
      model: 'z-ai/glm-5.3',
      pinnedProvider: 'z-ai',
      persona: 'agent:iterate',
      instructions: body,
      tools: ['read_page', 'query_entities'],
      messages: [{ role: 'user', text: FIXTURE_ITEM_PROMPT }],
    });
    const asking = async (request: TurnRequest): Promise<TurnResult> => {
      requests.push(request);
      if (requests.length > 2) return ended;
      return { ...ended, toolCalls: [{ callId: 'c1', verb: 'read_page', input: {} }] };
    };
    expect(await dryRun(persona(), asking)).toBeNull();
    expect(requests.at(-1)?.messages.at(-1)).toMatchObject({
      role: 'tool',
      verb: 'read_page',
      output: { error: 'dry_run' },
      isError: true,
    });
    const failing = async (): Promise<TurnResult> => Promise.reject(new Error('down'));
    expect(await dryRun(persona(), failing)).toEqual({
      message: 'persona iterate failed its dry run turn',
    });
  });
});
