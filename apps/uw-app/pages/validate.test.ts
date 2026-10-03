import { describe, expect, it } from 'vitest';
import { checkFrontmatter } from './validate.ts';

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

describe('FD-9 frontmatter is validated by page type', () => {
  it('refuses a type the registry does not hold', () => {
    expect(checkFrontmatter('policy', {})).toEqual({ ok: false, reason: 'unknown_page_type' });
  });

  it('refuses a name that only exists on the object prototype', () => {
    expect(checkFrontmatter('constructor', {})).toEqual({
      ok: false,
      reason: 'unknown_page_type',
    });
  });

  it('accepts valid persona frontmatter and names the type', () => {
    expect(checkFrontmatter('persona', persona)).toEqual({
      ok: true,
      type: 'persona',
      frontmatter: { ...persona, provider: null },
    });
  });

  it('refuses a persona whose toolset holds a verb that does not exist', () => {
    expect(checkFrontmatter('persona', { ...persona, toolset: ['approve'] })).toEqual({
      ok: false,
      reason: 'invalid_frontmatter',
    });
  });

  it('refuses a learning with a confidence outside the closed set', () => {
    const learning = {
      confidence: 'certain',
      as_of: '2026-10-01',
      supersedes: [],
      review_by: null,
    };
    expect(checkFrontmatter('learning', learning)).toEqual({
      ok: false,
      reason: 'invalid_frontmatter',
    });
  });

  it('refuses a skill with an extra key', () => {
    const skill = { name: 'write-notes', description: 'Draft notes.', extra: true };
    expect(checkFrontmatter('skill', skill)).toEqual({ ok: false, reason: 'invalid_frontmatter' });
  });
});
