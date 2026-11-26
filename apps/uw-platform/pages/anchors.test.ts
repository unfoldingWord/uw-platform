import { describe, expect, it } from 'vitest';
import { anchorOf, resolveAnchor } from './anchors.ts';

const body = 'Two adults are present at every session. Each adult has a current check.';

describe('#197 a suggested change is anchored by position and by quote', () => {
  it('records the span, the quoted text and up to 32 characters either side', () => {
    const start = body.indexOf('every');
    const anchor = anchorOf(body, start, start + 'every'.length);
    expect(anchor).toEqual({
      start,
      end: start + 5,
      exact: 'every',
      prefix: 'Two adults are present at ',
      suffix: ' session. Each adult has a curre',
    });
  });

  it('resolves at its own position while the text there is unchanged', () => {
    const anchor = anchorOf(body, 4, 10);
    expect(resolveAnchor(body, anchor)).toEqual({ kind: 'anchored', start: 4, end: 10 });
  });

  it('re-anchors by quote once text before it has moved', () => {
    const anchor = anchorOf(body, body.indexOf('every'), body.indexOf('every') + 5);
    const edited = `Safeguarding. ${body}`;
    const start = edited.indexOf('every');
    expect(resolveAnchor(edited, anchor)).toEqual({ kind: 'anchored', start, end: start + 5 });
  });

  it('re-anchors an insertion by the text either side of it', () => {
    const at = body.indexOf('adults');
    const anchor = anchorOf(body, at, at);
    const edited = `Note. ${body}`;
    expect(resolveAnchor(edited, anchor)).toEqual({
      kind: 'anchored',
      start: at + 6,
      end: at + 6,
    });
  });

  it('reports an anchor whose quote is gone as orphaned, never guessing', () => {
    const anchor = anchorOf(body, body.indexOf('every'), body.indexOf('every') + 5);
    expect(resolveAnchor('Nothing like it remains.', anchor)).toEqual({
      kind: 'orphaned',
      why: 'missing',
    });
  });

  it('reports an anchor whose quote now appears twice as orphaned', () => {
    const short = 'An adult. An adult.';
    const anchor = { start: 3, end: 8, exact: 'adult', prefix: 'An ', suffix: '.' };
    expect(resolveAnchor(`${short} ${short}`, { ...anchor, start: 40, end: 45 })).toEqual({
      kind: 'orphaned',
      why: 'ambiguous',
    });
  });
});
