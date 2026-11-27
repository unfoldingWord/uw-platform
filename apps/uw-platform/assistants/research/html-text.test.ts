import { describe, expect, it } from 'vitest';
import { pageWords } from './html-text.ts';

describe('PA-19 a page read as text', () => {
  it('keeps the title and the visible words, one block a line, and drops scripts and styles', () => {
    const html = [
      '<!doctype html><html><head><title>Tickets &amp; prices</title>',
      '<style>body { color: red }</style><script>window.secret = 1</script></head>',
      '<body><h1>Registration</h1><p>Early bird&nbsp;ticket: 250&#160;CHF</p>',
      '<!-- hidden comment --><ul><li>Standard 320 CHF</li><li>Student &#x31;00 CHF</li></ul>',
      '<noscript>Turn on JavaScript</noscript></body></html>',
    ].join('');
    expect(pageWords(html)).toEqual({
      title: 'Tickets & prices',
      text: 'Registration\nEarly bird ticket: 250 CHF\nStandard 320 CHF\nStudent 100 CHF',
      scripted: true,
    });
  });

  it('marks a page with scripts and almost no words as scripted, so it may be rendered', () => {
    const words = pageWords(
      '<html><body><div id="app"></div><script src="/app.js"></script></body></html>',
    );
    expect(words.text).toBe('');
    expect(words.scripted).toBe(true);
  });

  it('keeps a header element while dropping the head', () => {
    expect(pageWords('<head><title>T</title></head><header>Geneva, March</header>').text).toBe(
      'Geneva, March',
    );
  });

  it('survives an unclosed script without reading past it', () => {
    expect(pageWords('<p>Before</p><script>never closed').text).toBe('Before');
  });
});
