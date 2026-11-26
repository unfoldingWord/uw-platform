import { describe, expect, it } from 'vitest';
import { charterSections, policyFrontmatterSchema } from './policies.ts';

const niso = [
  '## Need',
  'Translators wait months for checked notes.',
  '## Idea',
  'Check notes as they are written.',
  '## Strategy',
  'Start with two languages.',
  '## Outcomes',
  'Notes checked within a week.',
  '## Risks',
  '## Roadmap',
  'Pilot in the first quarter.',
].join('\n');

describe('PO-4 a charter follows the NISO template', () => {
  it('reads each section of a complete charter', () => {
    const read = charterSections(niso);
    expect(read.missing).toEqual([]);
    expect(read.sections).toEqual({
      Need: 'Translators wait months for checked notes.',
      Idea: 'Check notes as they are written.',
      Strategy: 'Start with two languages.',
      Outcomes: 'Notes checked within a week.',
      Risks: '',
      Roadmap: 'Pilot in the first quarter.',
    });
  });

  it('names each section that is absent', () => {
    expect(charterSections('## Need\nA need.\n## Outcomes\nSome.').missing).toEqual([
      'Idea',
      'Strategy',
      'Risks',
      'Roadmap',
    ]);
  });

  it('counts a section out of order as missing', () => {
    const swapped = niso.replace('## Idea', '## Placeholder').replace('## Roadmap', '## Idea');
    expect(charterSections(swapped).missing).toEqual(['Idea', 'Roadmap']);
    expect(charterSections(`## Roadmap\n\n${niso.replace('## Roadmap', '')}`).missing).toEqual([
      'Roadmap',
    ]);
  });

  it('ignores a heading inside a fenced block and matches any letter case', () => {
    const fenced = `\`\`\`\n## Need\n\`\`\`\n${niso.replace('## Need', '## NEED ##')}`;
    expect(charterSections(fenced).missing).toEqual([]);
    expect(charterSections('```\n## Need\n```').missing).toContain('Need');
  });

  it('allows further sections after the six', () => {
    expect(charterSections(`${niso}\n## Budget\nSee the ledger.`).missing).toEqual([]);
  });
});

describe('PO-4 a heading inside a fenced example is not a section', () => {
  it('closes a fence only on the same mark at least as long as the one that opened it', () => {
    const example = [
      '~~~~',
      '~~~',
      '## Need',
      '## Idea',
      '## Strategy',
      '## Outcomes',
      '## Risks',
      '## Roadmap',
      '~~~~',
    ].join('\n');
    expect(charterSections(example).missing).toHaveLength(6);
    expect(charterSections(`\`\`\`\n~~~\n\`\`\`\n${niso}`).missing).toEqual([]);
    expect(charterSections(`   ## Need\n${niso.replace('## Need', '')}`).missing).toEqual([]);
  });
});

describe('PO-1 a policy names how it binds and when it holds', () => {
  it('defaults to the whole organization, superseding nothing, with no end', () => {
    expect(
      policyFrontmatterSchema.parse({ enforcement: 'required', effective_from: '2026-12-01' }),
    ).toEqual({
      enforcement: 'required',
      applies_to: null,
      supersedes: [],
      effective_from: '2026-12-01',
      effective_until: null,
      copied_from: null,
    });
  });

  it('refuses an end on or before the start, and a repeated supersession', () => {
    const start = { enforcement: 'default', effective_from: '2026-12-01' } as const;
    const twice = '7f1c6a52-3e7b-4b9a-9a51-6a0f2c1d8e40';
    expect(
      policyFrontmatterSchema.safeParse({ ...start, effective_until: '2026-12-01' }).success,
    ).toBe(false);
    expect(
      policyFrontmatterSchema.safeParse({ ...start, supersedes: [twice, twice] }).success,
    ).toBe(false);
  });
});
