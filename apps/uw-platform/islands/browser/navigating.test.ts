import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireNavigating } from './navigating.ts';

function page(markup: string): JSDOM {
  const dom = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, {
    url: 'https://uw.example/harnesses/h1/queue',
  });
  wireNavigating(dom.window.document);
  dom.window.document.addEventListener('click', (event) => event.preventDefault(), {
    capture: false,
  });
  return dom;
}

function clicked(dom: JSDOM, selector: string, init: MouseEventInit = {}): boolean {
  const link = dom.window.document.querySelector(selector);
  link?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, button: 0, ...init }));
  return dom.window.document.documentElement.hasAttribute('data-navigating');
}

describe('the bar that shows a page is on its way', () => {
  it('starts when a link to another page in the app is clicked', () => {
    expect(clicked(page('<a id="go" href="/harnesses/h1/runs">Runs</a>'), '#go')).toBe(true);
  });

  it('stays still for new tabs, other sites, downloads, same-page anchors and modified clicks', () => {
    const links = [
      '<a id="go" href="/runs" target="_blank">x</a>',
      '<a id="go" href="https://other.example/">x</a>',
      '<a id="go" href="/file" download>x</a>',
      '<a id="go" href="#main">x</a>',
    ];
    for (const link of links) expect(clicked(page(link), '#go')).toBe(false);
    expect(clicked(page('<a id="go" href="/runs">x</a>'), '#go', { metaKey: true })).toBe(false);
  });

  it('starts for a plain form post but not one a script took over, and stops on return', () => {
    const dom = page('<form id="plain"></form><form id="taken"></form>');
    const document = dom.window.document;
    document.getElementById('taken')?.addEventListener('submit', (event) => event.preventDefault());
    const submit = (id: string) =>
      document
        .getElementById(id)
        ?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    submit('taken');
    expect(document.documentElement.hasAttribute('data-navigating')).toBe(false);
    submit('plain');
    expect(document.documentElement.hasAttribute('data-navigating')).toBe(true);
    dom.window.dispatchEvent(new dom.window.Event('pageshow'));
    expect(document.documentElement.hasAttribute('data-navigating')).toBe(false);
  });
});
