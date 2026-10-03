import { modelIdSchema, personaFrontmatterSchema } from '@uw/contracts';
import { engineDescriptor } from '../engines.ts';
import { refused, type Refused } from '../outcome.ts';
import type { PageFacts } from '../ports.ts';
import type { RunPersona } from './types.ts';

type PersonaFrontmatter = ReturnType<typeof personaFrontmatterSchema.parse>;

export type PersonaPage = { readonly facts: PageFacts; readonly frontmatter: PersonaFrontmatter };

export function personaPageOf(facts: PageFacts | undefined): PersonaPage | null {
  if (facts === undefined || facts.type !== 'persona' || facts.status !== 'active') return null;
  const parsed = personaFrontmatterSchema.safeParse(facts.frontmatter);
  if (!parsed.success || !modelIdSchema.safeParse(parsed.data.model).success) return null;
  return { facts, frontmatter: parsed.data };
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
    toolset: frontmatter.toolset,
    instructions: page.facts.bodyMd,
  };
}
