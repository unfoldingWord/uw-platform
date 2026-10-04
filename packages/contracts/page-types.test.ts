import { describe, expect, it } from 'vitest';
import { classificationSchema, offlineEligibilitySchema } from './closed-sets.ts';
import {
  dataSourceKindSchema,
  issueFrontmatterSchema,
  learningFrontmatterSchema,
  pageTypeDefinition,
  pageTypeRegistry,
  personaFrontmatterSchema,
} from './page-types.ts';
import { pageTypes } from './pages.ts';

const persona = {
  identity: 'agent:builder',
  owner: 'human:00000000-0000-4000-8000-000000000001',
  harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  toolset: ['read_page', 'claim_item'],
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'glm-5.3-flash',
  budget: { monthly_minor: 5000, currency: 'USD' },
  capability: 'build',
  requires_tools: ['read_page', 'open_pull_request'],
};

function acceptsPersona(overrides: Record<string, unknown>): boolean {
  return personaFrontmatterSchema.safeParse({ ...persona, ...overrides }).success;
}

describe('FD-9 the page-type registry', () => {
  it('registers exactly the eight v1 page types', () => {
    expect(Object.keys(pageTypeRegistry)).toEqual([...pageTypes]);
  });

  it.each(pageTypes)(
    'gives %s a frontmatter schema, a classification and an offline eligibility',
    (type) => {
      const definition = pageTypeDefinition(type);
      expect(definition?.frontmatter).toBeDefined();
      expect(classificationSchema.safeParse(definition?.classification).success).toBe(true);
      expect(offlineEligibilitySchema.safeParse(definition?.offlineEligibility).success).toBe(true);
    },
  );

  it('knows no type outside the registry', () => {
    expect(pageTypeDefinition('policy')).toBeUndefined();
    expect(pageTypeDefinition('constructor')).toBeUndefined();
  });
});

describe('FD-9 the persona frontmatter', () => {
  it('refuses a toolset name that is not verb-shaped, and an engine outside the six', () => {
    expect(acceptsPersona({})).toBe(true);
    expect(acceptsPersona({ toolset: ['Approve'] })).toBe(false);
    expect(acceptsPersona({ engine: 'gpt-5' })).toBe(false);
  });

  it('refuses a toolset that names a verb twice', () => {
    expect(acceptsPersona({ toolset: ['read_page', 'read_page'] })).toBe(false);
  });

  it('lets requires_tools name a verb that does not exist yet', () => {
    expect(acceptsPersona({ requires_tools: ['verb_not_built_yet'] })).toBe(true);
    expect(acceptsPersona({ requires_tools: ['Not-A-Verb'] })).toBe(false);
  });

  it('takes an agent identity as identity and a human identity as owner', () => {
    expect(acceptsPersona({ identity: 'human:ian' })).toBe(false);
    expect(acceptsPersona({ identity: 'agent:jesse/laptop-1' })).toBe(false);
    expect(acceptsPersona({ owner: 'agent:builder' })).toBe(false);
  });
});

describe('FD-9 the data-sources kind set', () => {
  it('is the closed set of source kinds', () => {
    expect(dataSourceKindSchema.options).toEqual(['web_analytics', 'mailing_list', 'manual']);
  });
});

const issue = {
  repo: 'unfoldingWord/uw-platform',
  number: 42,
  github_id: 9100000001,
  url: 'https://github.com/unfoldingWord/uw-platform/issues/42',
};

describe('GH-3 an issue page links to the issue it mirrors', () => {
  it('validates the repository, number, GitHub id and url of the issue', () => {
    expect(issueFrontmatterSchema.safeParse(issue).success).toBe(true);
    expect(pageTypeDefinition('issue')?.frontmatter.safeParse(issue).success).toBe(true);
  });

  it('refuses an issue page with no url, a zero number or a repository that is not owner/name', () => {
    const withoutUrl = { repo: issue.repo, number: issue.number, github_id: issue.github_id };
    expect(issueFrontmatterSchema.safeParse(withoutUrl).success).toBe(false);
    expect(issueFrontmatterSchema.safeParse({ ...issue, number: 0 }).success).toBe(false);
    expect(issueFrontmatterSchema.safeParse({ ...issue, repo: 'uw-platform' }).success).toBe(false);
  });
});

describe('a persona pins its provider', () => {
  it('reads a persona without a provider as null and takes a provider slug', () => {
    expect(personaFrontmatterSchema.parse(persona).provider).toBeNull();
    expect(acceptsPersona({ provider: 'z-ai' })).toBe(true);
    expect(acceptsPersona({ provider: 'Z AI' })).toBe(false);
  });
});

describe('the persona status and the derived tools', () => {
  it("carries the page's status, defaulting to suggested", () => {
    expect(personaFrontmatterSchema.parse(persona).status).toBe('suggested');
    expect(acceptsPersona({ status: 'active' })).toBe(true);
    expect(acceptsPersona({ status: 'live' })).toBe(false);
  });

  it('lets a toolset name a verb that does not exist yet, and defaults requires_tools to empty', () => {
    expect(acceptsPersona({ toolset: ['summarise_measurements'] })).toBe(true);
    expect(acceptsPersona({ toolset: ['Bad'] })).toBe(false);
    expect(acceptsPersona({ toolset: ['a'.repeat(65)] })).toBe(false);
    expect(acceptsPersona({ toolset: ['a'.repeat(64)] })).toBe(true);
    const many = Array.from({ length: 51 }, (_, index) => `verb_${'x'.repeat(index + 1)}`);
    expect(acceptsPersona({ toolset: many })).toBe(false);
    expect(acceptsPersona({ toolset: many.slice(0, 50) })).toBe(true);
    const withoutRequired = Object.fromEntries(
      Object.entries(persona).filter(([key]) => key !== 'requires_tools'),
    );
    expect(personaFrontmatterSchema.parse(withoutRequired).requires_tools).toEqual([]);
  });
});

describe('the learning contradiction flag', () => {
  const learning = { confidence: 'assumed', as_of: '2026-10-01', supersedes: [], review_by: null };

  it('is false by default and takes a boolean', () => {
    expect(learningFrontmatterSchema.parse(learning).contradicts).toBe(false);
    expect(learningFrontmatterSchema.parse({ ...learning, contradicts: true }).contradicts).toBe(
      true,
    );
    expect(learningFrontmatterSchema.safeParse({ ...learning, contradicts: 'yes' }).success).toBe(
      false,
    );
  });
});
