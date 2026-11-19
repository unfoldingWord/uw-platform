import {
  modelIdSchema,
  personaFrontmatterSchema,
  verbNameSchema,
  type Principal,
  type VerbName,
} from '@uw/contracts';
import { allowed } from '../access.ts';
import { engineDescriptor } from '../engines.ts';
import { refused, type Refused } from '../outcome.ts';
import type { PageFacts, RunRow, StoreTransaction } from '../ports.ts';
import type { RunPersona } from './types.ts';

type PersonaFrontmatter = ReturnType<typeof personaFrontmatterSchema.parse>;

export type PersonaPage = {
  readonly facts: PageFacts;
  readonly frontmatter: PersonaFrontmatter;
  readonly toolset: readonly VerbName[];
};

const servedToolset = verbNameSchema.array();

export function personaPageOf(facts: PageFacts | undefined): PersonaPage | null {
  if (facts === undefined || facts.type !== 'persona' || facts.status !== 'active') return null;
  const parsed = personaFrontmatterSchema.safeParse(facts.frontmatter);
  if (!parsed.success || !modelIdSchema.safeParse(parsed.data.model).success) return null;
  const toolset = servedToolset.safeParse(parsed.data.toolset);
  if (!toolset.success) return null;
  return { facts, frontmatter: parsed.data, toolset: toolset.data };
}

export function personaOfPage(facts: PageFacts | undefined): RunPersona | Refused {
  const page = personaPageOf(facts);
  if (page === null) return refused('page_not_found', { pageId: facts?.id ?? null });
  const { frontmatter } = page;
  const provider = frontmatter.provider ?? engineDescriptor(frontmatter.engine).defaultProvider;
  if (provider === null) return refused('malformed_command', { why: 'provider_required' });
  return {
    identity: frontmatter.identity,
    pageId: page.facts.id,
    engine: frontmatter.engine,
    model: frontmatter.model,
    provider,
    toolset: page.toolset,
    instructions: page.facts.bodyMd,
    approveAt: frontmatter.approve_at,
  };
}

export function pinnedPersonaOf(run: RunRow, facts: PageFacts | undefined): RunPersona | Refused {
  const page = personaPageOf(facts);
  if (page === null) return refused('page_not_found', { pageId: facts?.id ?? null });
  const { frontmatter } = page;
  if (frontmatter.identity !== run.persona || frontmatter.harness !== run.harnessId) {
    return refused('not_permitted', { why: 'run_elsewhere' });
  }
  if (run.pinnedProvider === null)
    return refused('malformed_command', { why: 'provider_required' });
  return {
    identity: run.persona,
    pageId: page.facts.id,
    engine: run.engine,
    model: run.model,
    provider: run.pinnedProvider,
    toolset: page.toolset,
    instructions: page.facts.bodyMd,
    approveAt: frontmatter.approve_at,
  };
}

export function hiddenPersona(
  principal: Principal,
  facts: PageFacts | undefined,
  pageId: string | null,
  at: Date,
): Refused | null {
  if (facts !== undefined && allowed(principal, 'read', facts, at)) return null;
  return refused('page_not_found', { pageId });
}

export async function unreadablePersona(
  tx: StoreTransaction,
  principal: Principal,
  pageId: string,
  at: Date,
): Promise<Refused | null> {
  const [facts] = await tx.pages.read.facts([pageId]);
  return hiddenPersona(principal, facts, pageId, at);
}
