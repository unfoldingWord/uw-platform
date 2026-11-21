import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wirePassageComment, type Selected } from './passage.ts';

function screen(selected: (document: Document) => Selected) {
  const { document } = new JSDOM(
    `<main><div data-page-body=""><p id="in">The limit is   50 dollars.</p></div>
     <p id="out">Elsewhere.</p>
     <button type="button" data-comment-passage data-href="/pages/p1/comments">Comment</button></main>`,
  ).window;
  const went: string[] = [];
  wirePassageComment(document, {
    selected: () => selected(document),
    go: (href) => went.push(href),
  });
  document.querySelector('button')?.click();
  return went;
}

describe('#175 a reader comments on a passage they selected', () => {
  it('opens the comments with the selected words from the page', () => {
    const went = screen((document) => ({
      text: 'limit is   50\n dollars',
      inside: document.querySelector('#in')?.firstChild ?? null,
    }));
    expect(went).toEqual(['/pages/p1/comments?quote=limit%20is%2050%20dollars']);
  });

  it('opens the comments plainly when nothing in the page is selected', () => {
    expect(screen(() => ({ text: '', inside: null }))).toEqual(['/pages/p1/comments']);
    const outside = screen((document) => ({
      text: 'Elsewhere',
      inside: document.querySelector('#out') ?? null,
    }));
    expect(outside).toEqual(['/pages/p1/comments']);
  });
});
