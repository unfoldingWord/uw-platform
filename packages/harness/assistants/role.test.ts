import {
  assistantIdentityOf,
  identitySchema,
  personaFrontmatterSchema,
  templateKeySchema,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { templates } from '../templates.ts';
import { walk } from '../walk.ts';
import {
  ASSISTANT_TOOLSET,
  assistantPersonaDraft,
  assistantRole,
  assistantTemplate,
} from './role.ts';

const personId = '00000000-0000-4000-8000-000000000105';
const harness = { id: '00000000-0000-4000-8000-0000000000a1', jdArea: '90-99', personId } as const;
const owner = identitySchema.parse('human:00000000-0000-4000-8000-000000000001');

describe('PA-1 the assistant role seeds one persona per person', () => {
  it('drafts a persona page that parses, named for its person and bound to their harness', () => {
    const draft = assistantPersonaDraft(harness, owner);
    const frontmatter = personaFrontmatterSchema.parse(draft.frontmatter);
    expect(frontmatter.identity).toBe(assistantIdentityOf(personId));
    expect(frontmatter.harness).toBe(harness.id);
    expect(frontmatter.capability).toBe('assist');
    expect(frontmatter.toolset).toEqual([...ASSISTANT_TOOLSET]);
    expect(draft.slug).toBe(`persona-assistant-${personId}`);
  });

  it('refuses to draft for a harness that belongs to nobody', () => {
    expect(() => assistantPersonaDraft({ ...harness, personId: null }, owner)).toThrow(RangeError);
  });

  it('holds no write verb and runs metered on the platform', () => {
    expect(assistantRole.toolset).not.toContain('write_page');
    expect(assistantRole.toolset).not.toContain('create_task');
    expect(assistantRole.run_shape).toBe('workflow-run');
    expect(assistantRole.budget.monthly_minor).toBeGreaterThan(0);
  });
});

describe('PA-1 the assistant template is reachable only through provisioning', () => {
  it('is personal, has no stages and walks to no effect', () => {
    expect(assistantTemplate.personal).toBe(true);
    expect(assistantTemplate.stages).toEqual([]);
    expect(walk(assistantTemplate.stages)).toEqual([]);
  });

  it('is neither in the template registry nor a template key a command accepts', () => {
    expect(templates.has(assistantTemplate.key)).toBe(false);
    expect(templateKeySchema.safeParse(assistantTemplate.key).success).toBe(false);
  });
});
