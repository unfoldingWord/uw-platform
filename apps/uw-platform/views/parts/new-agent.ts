import { personaSlugSchema, templateKeySchema, type Identity, type JdArea } from '@uw/contracts';
import { personaPageDraft, personasOf } from '@uw/harness';

type Fixture = ReturnType<typeof personasOf>[number];
type Draft = ReturnType<typeof personaPageDraft>;

const SLUG_LIMIT = 64;

export function agentSlug(name: string, harnessKey: string): string | null {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base === '') return null;
  const slug = `${base}-${harnessKey}`.slice(0, SLUG_LIMIT).replace(/-+$/, '');
  return personaSlugSchema.safeParse(slug).success ? slug : null;
}

export function templateChoices(): readonly Fixture[] {
  const seen = new Map<string, Fixture>();
  for (const key of templateKeySchema.options) {
    for (const fixture of personasOf(key)) {
      if (!seen.has(fixture.slug)) seen.set(fixture.slug, fixture);
    }
  }
  return [...seen.values()];
}

export type AgentDraftInput = {
  readonly fixture: Fixture;
  readonly harness: { readonly id: string; readonly key: string; readonly jdArea: JdArea };
  readonly owner: Identity;
  readonly name: string;
  readonly model: string;
};

function renamed(body: string, from: string, to: string): string {
  const lines = body.split('\n');
  if (lines[0] !== '---' || lines[1] !== `name: ${from}`) return body;
  return ['---', `name: ${to}`, ...lines.slice(2)].join('\n');
}

export function agentDraft(input: AgentDraftInput): Draft | null {
  const slug = agentSlug(input.name, input.harness.key);
  if (slug === null) return null;
  const base = personaPageDraft(input.fixture, input.harness, input.owner);
  const model = input.model.trim();
  return {
    slug: `persona-${slug}`,
    title: input.name.trim(),
    bodyMd: renamed(base.bodyMd, input.fixture.slug, slug),
    frontmatter: {
      ...base.frontmatter,
      identity: `agent:${slug}`,
      ...(model === '' ? {} : { model }),
    },
  };
}
