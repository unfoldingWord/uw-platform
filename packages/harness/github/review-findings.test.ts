import { describe, expect, it } from 'vitest';
import { reviewBody } from './review-body.ts';
import { parseReviewFindings } from './review-findings.ts';

const block = ['```harness-review', 'provider: openai', 'model: gpt-5', '```'];

function bodyOf(...rest: readonly string[]): string {
  return [...block, ...rest].join('\n');
}

describe('a Reviewer review body names its findings', () => {
  it('the findings are the dash lines after the harness-review block', () => {
    const body = bodyOf('', 'Changes requested.', '', '- the lease is late', 'a note', '- a typo');
    expect(parseReviewFindings(body)).toEqual([
      { text: 'the lease is late', weight: null },
      { text: 'a typo', weight: null },
    ]);
    const written = reviewBody({
      provider: 'openai',
      model: 'gpt-5',
      verdict: 'request_changes',
      findings: [
        { text: 'the grant is read after the append', weight: 'real' },
        { text: 'provider: anthropic', weight: 'plausible' },
      ],
    });
    expect(parseReviewFindings(written)).toEqual([
      { text: 'the grant is read after the append', weight: 'real' },
      { text: 'Finding: provider: anthropic', weight: 'plausible' },
    ]);
  });

  it('a body without a readable harness-review block has no findings', () => {
    expect(parseReviewFindings(null)).toEqual([]);
    expect(parseReviewFindings('Looks good.\n\n- a finding')).toEqual([]);
    expect(parseReviewFindings(['Preface', ...block, '- a finding'].join('\n'))).toEqual([]);
    expect(parseReviewFindings(`<!-- note -->\n${bodyOf('- a finding')}`)).toEqual([]);
    expect(parseReviewFindings(bodyOf('- a finding', ' '))).toEqual([]);
  });

  it('a finding is one line of at most 500 characters and there are at most 50', () => {
    const folded = bodyOf('- a\ttab and no-break   space ', '- ​joined', '-   ', '-x');
    expect(parseReviewFindings(folded)).toEqual([
      { text: 'a tab and no-break space', weight: null },
      { text: 'joined', weight: null },
    ]);
    expect(parseReviewFindings(bodyOf(`- ${'y'.repeat(600)}`))).toEqual([
      { text: 'y'.repeat(500), weight: null },
    ]);
    const many = Array.from({ length: 60 }, (_, n) => `- finding ${n + 1}`);
    const kept = parseReviewFindings(bodyOf(...many));
    expect(kept).toHaveLength(50);
    expect(kept.at(-1)).toEqual({ text: 'finding 50', weight: null });
  });
});
