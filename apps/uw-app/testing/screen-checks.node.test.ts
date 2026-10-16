import { describe, expect, it } from 'vitest';
import { screenProblems } from './screen-checks.ts';

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><title>Copy</title></head><body><main>${body}</main></body></html>`;
}

async function brandProblems(body: string): Promise<readonly string[]> {
  const problems = await screenProblems(page(body));
  return problems.filter((problem) => problem.startsWith('unfoldingWord written'));
}

describe('WB-12 the copy check reads the brand beside an address', () => {
  it('WB-12 flags a misspelled brand in an element that touches an address', async () => {
    expect(await brandProblems('<b>Unfolding Word</b><i>help@unfoldingword.org</i>')).toEqual([
      'unfoldingWord written Unfolding Word',
    ]);
  });

  it('WB-12 passes an address alone and the brand written right', async () => {
    expect(await brandProblems('<p>Write to help@unfoldingword.org</p>')).toEqual([]);
    expect(await brandProblems('<p>unfoldingWord</p><i>help@unfoldingword.org</i>')).toEqual([]);
  });

  it('WB-12 passes the brand written right across inline elements', async () => {
    expect(await brandProblems('<p>unfolding<b>Word</b> helps</p>')).toEqual([]);
  });

  it('WB-12 reads block elements apart as a browser renders them, never as one joined word', async () => {
    expect(await brandProblems('<ul><li>unfolding</li><li>word</li></ul>')).toEqual([
      'unfoldingWord written unfolding word',
    ]);
  });
});
