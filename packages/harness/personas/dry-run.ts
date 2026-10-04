import {
  personaFrontmatterSchema,
  personaSlugOf,
  verbNameSchema,
  type Identity,
} from '@uw/contracts';
import { engineDescriptor, hostable } from '../engines.ts';
import type { ModelEngine, TurnRequest, TurnResult } from '../ports.ts';
import { runToolLoop, type ToolCaller } from '../runs/tool-loop.ts';
import { parseAgentSkillHeader } from './instructions.ts';

type PersonaFrontmatter = ReturnType<typeof personaFrontmatterSchema.parse>;

export type DryRunPersona = {
  readonly identity: Identity;
  readonly frontmatter: PersonaFrontmatter;
  readonly body: string;
};
export type DryRunProblem = { readonly message: string };

export const FIXTURE_ITEM_PROMPT =
  'Dry run. Item: "Fixture item" in stage scope. Reply without calling a tool.';
const FIXTURE_TRACE = '00000000-0000-4000-8000-000000000000';

async function fixtureTurn(request: TurnRequest): Promise<TurnResult> {
  if (request.instructions.length === 0) throw new Error('a dry run turn needs instructions');
  return {
    toolCalls: [],
    text: 'dry run',
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0, costMicros: 0, costBasis: 'metered' },
    resolvedProvider: request.pinnedProvider,
    resolvedModel: request.model,
  };
}

const refuseEveryTool: ToolCaller = {
  call: async () => ({ output: { error: 'dry_run' }, isError: true }),
};

function problem(message: string): DryRunProblem {
  return { message };
}

function resolvedProvider(frontmatter: PersonaFrontmatter): string | null {
  return frontmatter.provider ?? engineDescriptor(frontmatter.engine).defaultProvider;
}

function configurationProblem(persona: DryRunPersona, slug: string): DryRunProblem | null {
  const { frontmatter } = persona;
  const header = parseAgentSkillHeader(persona.body);
  if ('problem' in header) {
    return problem(
      `persona ${slug} instructions are not an agentskills document: ${header.problem}`,
    );
  }
  if (header.name !== slug) return problem(`persona ${slug} instructions are named ${header.name}`);
  const { engine, run_shape: shape } = frontmatter;
  if (!hostable(engine, shape)) {
    return problem(`persona ${slug} runs ${shape} on ${engine}, which cannot host it`);
  }
  if (shape === 'workflow-run' && resolvedProvider(frontmatter) === null) {
    return problem(`persona ${slug} names no provider for ${engine}`);
  }
  if (frontmatter.capability === 'review' && frontmatter.toolset.includes('write_page')) {
    return problem(`persona ${slug} reviews and may not hold write_page`);
  }
  return null;
}

async function turnProblem(
  persona: DryRunPersona,
  slug: string,
  turn: ModelEngine['turn'],
): Promise<DryRunProblem | null> {
  const failed = problem(`persona ${slug} failed its dry run turn`);
  const tools = verbNameSchema.array().safeParse(persona.frontmatter.toolset);
  if (!tools.success) return failed;
  const request = {
    engine: persona.frontmatter.engine,
    model: persona.frontmatter.model,
    pinnedProvider: resolvedProvider(persona.frontmatter),
    persona: persona.identity,
    instructions: persona.body,
    tools: tools.data,
    prompt: FIXTURE_ITEM_PROMPT,
    traceId: FIXTURE_TRACE,
  };
  try {
    const result = await runToolLoop(turn, refuseEveryTool, request, async () => undefined);
    return result.outcome === 'ended' ? null : failed;
  } catch {
    return failed;
  }
}

export async function dryRun(
  persona: DryRunPersona,
  turn: ModelEngine['turn'] = fixtureTurn,
): Promise<DryRunProblem | null> {
  const slug = personaSlugOf(persona.identity) ?? persona.identity;
  return configurationProblem(persona, slug) ?? turnProblem(persona, slug, turn);
}
