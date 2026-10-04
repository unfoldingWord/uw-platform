import { describe, expect, it } from 'vitest';
import { frontmatterSchema, personaFrontmatterSchema, type Page } from '@uw/contracts';
import { personaFrontmatterFor, personaLanding } from './derive.ts';

const input = {
  identity: 'agent:builder',
  owner: 'human:00000000-0000-4000-8000-000000000001',
  harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  toolset: ['read_page', 'claim_item'],
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'glm-5.3-flash',
  budget: { monthly_minor: 5000, currency: 'USD' },
  capability: 'build',
  requires_tools: ['write_page'],
};

const parsed = (raw: Record<string, unknown>): Page['frontmatter'] =>
  frontmatterSchema.parse(personaFrontmatterSchema.parse(raw));

function stored(status: Page['status'], frontmatter: Page['frontmatter']): Page {
  return {
    id: '00000000-0000-4000-8000-000000000a01',
    type: 'persona',
    jdArea: '80-89',
    slug: 'persona-builder',
    title: 'Builder',
    parentId: null,
    frontmatter,
    bodyMd: 'instructions',
    version: 2,
    status,
  };
}

describe('the persona frontmatter the page writer derives', () => {
  it('writes the status the page lands in', () => {
    for (const status of ['draft', 'suggested', 'active', 'retired'] as const) {
      const derived = personaFrontmatterFor(parsed(input), input, { status, stored: null });
      expect(derived).toMatchObject({ ok: true, frontmatter: { status } });
    }
    const echoed = { ...input, status: 'active' };
    expect(
      personaFrontmatterFor(parsed(echoed), echoed, { status: 'retired', stored: 'active' }),
    ).toMatchObject({ ok: true, frontmatter: { status: 'retired' } });
  });

  it('refuses frontmatter that names active when the page does not land active', () => {
    const active = { ...input, status: 'active' };
    expect(
      personaFrontmatterFor(parsed(active), active, { status: 'suggested', stored: 'suggested' }),
    ).toEqual({ ok: false, reason: 'activation_required' });
    expect(
      personaFrontmatterFor(parsed(active), active, { status: 'suggested', stored: null }),
    ).toEqual({ ok: false, reason: 'activation_required' });
  });

  it('replaces requires_tools with the toolset', () => {
    const derived = personaFrontmatterFor(parsed(input), input, {
      status: 'suggested',
      stored: null,
    });
    expect(derived).toMatchObject({
      ok: true,
      frontmatter: {
        toolset: ['read_page', 'claim_item'],
        requires_tools: ['read_page', 'claim_item'],
      },
    });
  });
});

describe('an edit to an active persona returns it to suggested', () => {
  const current = { ...parsed(input), requires_tools: input.toolset, status: 'active' };

  it('lands suggested when the toolset or the instructions change, and stays active otherwise', () => {
    const page = stored('active', current);
    const widened = { ...current, toolset: [...input.toolset, 'write_page'] };
    expect(personaLanding(page, 'active', widened, page.bodyMd)).toBe('suggested');
    expect(personaLanding(page, 'active', current, 'new instructions')).toBe('suggested');
    expect(personaLanding(page, 'active', { ...current, status: 'suggested' }, page.bodyMd)).toBe(
      'active',
    );
    expect(personaLanding(page, 'retired', widened, page.bodyMd)).toBe('retired');
    expect(personaLanding(stored('suggested', current), 'suggested', widened, 'x')).toBe(
      'suggested',
    );
  });
});
