import {
  templateKeySchema,
  type ApproveAt,
  type CapabilityWord,
  type Engine,
  type Identity,
  type JdArea,
  type RunShape,
  type TemplateKey,
  type VerbName,
} from '@uw/contracts';

export type PersonaFixture = {
  readonly slug: string;
  readonly title: string;
  readonly toolset: readonly VerbName[];
  readonly run_shape: RunShape;
  readonly engine: Engine;
  readonly model: string;
  readonly provider: string | null;
  readonly capability: CapabilityWord;
  readonly approveAt: ApproveAt | null;
  readonly budget: { readonly monthly_minor: number; readonly currency: string };
  readonly bodyMd: string;
};

export type PersonaPageDraft = {
  readonly slug: string;
  readonly title: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly bodyMd: string;
};

const BUILDER_TOOLSET = [
  'search_pages',
  'read_page',
  'write_page',
  'resolve_context',
  'query_entities',
  'create_task',
  'poll_queue',
  'claim_item',
  'submit_to_gate',
  'record_run_step',
  'get_health',
] as const satisfies readonly VerbName[];
const REVIEWER_TOOLSET = [
  'search_pages',
  'read_page',
  'resolve_context',
  'query_entities',
  'poll_queue',
  'claim_item',
  'submit_to_gate',
  'record_run_step',
  'get_health',
] as const satisfies readonly VerbName[];
const ITERATE_TOOLSET = [
  'search_pages',
  'read_page',
  'write_page',
  'resolve_context',
  'query_entities',
  'poll_queue',
  'claim_item',
  'submit_to_gate',
  'record_run_step',
  'get_health',
] as const satisfies readonly VerbName[];

const budget = { monthly_minor: 20000, currency: 'USD' } as const;

function skill(slug: string, description: string, sections: readonly string[]): string {
  return ['---', `name: ${slug}`, `description: ${description}`, '---', '', ...sections].join('\n');
}

const builderSections = [
  '## Read',
  'Read the item, its package pages and the stage instructions with `resolve_context`.',
  '',
  '## Scout',
  'Verify the premise against the current code and data before you change anything. End your scout with a fenced `harness-scout` block naming `premise` (`holds` or `does_not_hold`) and a one-line `reason`.',
  '',
  '## Work',
  'Work on the branch `harness/<item>` and nowhere else.',
  '',
  '## Open the pull request',
  'Open one pull request from `harness/<item>` into the default branch. Its body opens with a fenced `harness` declaration naming `closes`, `risks`, `touches`, `risk_tier` and `risk_domains`.',
  '',
  '## Submit',
  'Call `submit_to_gate` with the pull request and the head you pushed.',
];

const reviewerSections = [
  '## Read',
  'Read the diff and the checks on the pull request at the head the item names.',
  '',
  '## Verdict',
  'End your review with a fenced `harness-verdict` block naming `verdict` (`approve` or `request_changes`).',
  '',
  '## Findings',
  'Write each finding on its own line after the block, starting with its weight: `- real: ...` for a defect you are sure of, `- plausible: ...` for one that may be real, `- theoretical: ...` for one that only could be. A finding without its weight is refused. No findings means approve.',
  '',
  '## Limits',
  'You never write a page and you never decide a gate.',
];

const iterateSections = [
  '## Read',
  'Read measurements only through `query_entities` with the `measurements_for_item` query.',
  '',
  '## Draft a revision',
  'Draft a revision of the product, its goal, its strategy or its data sources. Start every claim line with `[observed]`, `[confirmed]`, `[inferred]` or `[assumed]`.',
  '',
  '## Submit',
  'Attach the revision with a learning and submit along the `feeds` edge.',
];

const builder: PersonaFixture = {
  slug: 'builder',
  title: 'Builder',
  toolset: BUILDER_TOOLSET,
  run_shape: 'external-run',
  engine: 'external',
  model: 'unreported',
  provider: null,
  capability: 'build',
  approveAt: null,
  budget,
  bodyMd: skill('builder', 'Builder turns an approved plan into a declared pull request.', [
    ...builderSections,
  ]),
};

const builderHosted: PersonaFixture = {
  ...builder,
  slug: 'builder-hosted',
  title: 'Hosted Builder',
  run_shape: 'workflow-run',
  engine: 'claude-code-sandbox',
  model: 'claude-sonnet-4-5',
  provider: 'anthropic',
  bodyMd: skill(
    'builder-hosted',
    'Hosted Builder turns an approved plan into a declared pull request on the platform.',
    builderSections,
  ),
};

const reviewer: PersonaFixture = {
  slug: 'reviewer',
  title: 'Reviewer',
  toolset: REVIEWER_TOOLSET,
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'z-ai/glm-5.3-flash',
  provider: 'z-ai',
  capability: 'review',
  approveAt: 'no_real_or_plausible',
  budget,
  bodyMd: skill('reviewer', 'Reviewer reads a pull request and posts one verdict.', [
    ...reviewerSections,
  ]),
};

const reviewerCodex: PersonaFixture = {
  ...reviewer,
  slug: 'reviewer-codex',
  title: 'Second Reviewer',
  engine: 'codex-sandbox',
  model: 'gpt-5-codex',
  provider: 'openai',
  bodyMd: skill(
    'reviewer-codex',
    'The second Reviewer reads a pull request on another provider and posts one verdict.',
    reviewerSections,
  ),
};

const iterate: PersonaFixture = {
  slug: 'iterate',
  title: 'Iterate',
  toolset: ITERATE_TOOLSET,
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'z-ai/glm-5.3-flash',
  provider: 'z-ai',
  capability: 'iterate',
  approveAt: null,
  budget,
  bodyMd: skill('iterate', 'Iterate tunes a product from its measurements.', iterateSections),
};

export const templatePersonas: Readonly<Record<TemplateKey, readonly PersonaFixture[]>> = {
  software: [builder, builderHosted, reviewer, reviewerCodex],
  bml: [iterate],
  'check-only': [reviewer, reviewerCodex],
};

const byTemplate: ReadonlyMap<TemplateKey, readonly PersonaFixture[]> = new Map(
  Object.entries(templatePersonas).map(([key, fixtures]) => [
    templateKeySchema.parse(key),
    fixtures,
  ]),
);

export function personasOf(template: TemplateKey): readonly PersonaFixture[] {
  return byTemplate.get(template) ?? [];
}

export function personaPageDraft(
  fixture: PersonaFixture,
  harness: { readonly id: string; readonly jdArea: JdArea },
  owner: Identity,
): PersonaPageDraft {
  return {
    slug: `persona-${fixture.slug}`,
    title: fixture.title,
    bodyMd: fixture.bodyMd,
    frontmatter: {
      identity: `agent:${fixture.slug}`,
      owner,
      harness: harness.id,
      toolset: [...fixture.toolset],
      run_shape: fixture.run_shape,
      engine: fixture.engine,
      model: fixture.model,
      provider: fixture.provider,
      budget: { ...fixture.budget },
      capability: fixture.capability,
      ...(fixture.approveAt === null ? {} : { approve_at: fixture.approveAt }),
    },
  };
}
