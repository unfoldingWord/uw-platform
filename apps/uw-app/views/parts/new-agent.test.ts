import { describe, expect, it } from 'vitest';
import { personaFrontmatterSchema, type Identity } from '@uw/contracts';
import { personasOf } from '@uw/harness';
import { agentDraft, agentSlug, templateChoices } from './new-agent.ts';

const harness = {
  id: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  key: 'software',
  jdArea: '80-89' as const,
};
const owner = 'human:00000000-0000-4000-8000-000000000001' as Identity;
const reviewer = personasOf('software').find((fixture) => fixture.slug === 'reviewer');

describe('#110 an agent added from a template', () => {
  it('names its own agent after what the person typed and the workflow', () => {
    expect(agentSlug('Scout', 'software')).toBe('scout-software');
    expect(agentSlug('  Second Look!! ', 'bml-2026')).toBe('second-look-bml-2026');
    expect(agentSlug('***', 'software')).toBeNull();
  });

  it('copies the template, under its own identity, slug and instruction name', () => {
    if (reviewer === undefined) throw new Error('the software template has a reviewer');
    const draft = agentDraft({ fixture: reviewer, harness, owner, name: 'Scout', model: '' });
    if (draft === null) throw new Error('a draft');
    const front = personaFrontmatterSchema.parse(draft.frontmatter);
    expect(front.identity).toBe('agent:scout-software');
    expect(front.owner).toBe(owner);
    expect(front.harness).toBe(harness.id);
    expect(front.toolset).toEqual([...reviewer.toolset]);
    expect(front.model).toBe(reviewer.model);
    expect(draft.slug).toBe('persona-scout-software');
    expect(draft.title).toBe('Scout');
    expect(draft.bodyMd.startsWith('---\nname: scout-software\n')).toBe(true);
  });

  it('takes the model the person chose', () => {
    if (reviewer === undefined) throw new Error('the software template has a reviewer');
    const draft = agentDraft({ fixture: reviewer, harness, owner, name: 'Scout', model: ' x/y ' });
    expect(draft?.frontmatter['model']).toBe('x/y');
  });

  it('offers every template persona once', () => {
    const slugs = templateChoices().map((fixture) => fixture.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(expect.arrayContaining(['builder', 'reviewer', 'iterate']));
  });
});
