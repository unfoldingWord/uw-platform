import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { Disclosure } from './disclosure.tsx';
import { LinkTree } from './link-tree.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body>${markup}</body></html>`).window.document;
}

const nodes = [
  {
    label: 'Parent',
    href: '/pages/p',
    children: [{ label: 'Child', href: '/pages/c', children: [] }],
  },
  { label: 'Sibling', href: '/pages/s', children: [] },
];

describe('a disclosure over a tree of links', () => {
  it('starts open unless told otherwise, and closes when asked', async () => {
    const open = await dom(jsx(Disclosure, { summary: 'Shown', children: 'body' }));
    expect(open.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(open.querySelector('summary')?.textContent).toBe('Shown');
    const shut = await dom(jsx(Disclosure, { summary: 'Hidden', open: false, children: 'body' }));
    expect(shut.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('keeps its actions outside the summary, so a click on one never closes it', async () => {
    const document = await dom(
      jsx(Disclosure, {
        summary: 'Shown',
        actions: jsx('a', { href: '/new' }, 'New'),
        children: 'body',
      }),
    );
    expect(document.querySelector('summary a')).toBeNull();
    expect(document.querySelector('[data-disclosure-actions] a')?.getAttribute('href')).toBe(
      '/new',
    );
    const bare = await dom(jsx(Disclosure, { summary: 'Shown', children: 'body' }));
    expect(bare.querySelector('[data-disclosure-actions]')).toBeNull();
  });

  it('nests every child under its parent, every level shown', async () => {
    const document = await dom(jsx(LinkTree, { label: 'Pages', nodes }));
    const top = [...document.querySelectorAll('[data-tree] > li > a')];
    expect(top.map((link) => link.textContent)).toEqual(['Parent', 'Sibling']);
    const below = document.querySelector('[data-tree] > li > ul > li > a');
    expect(below?.getAttribute('href')).toBe('/pages/c');
    expect(document.querySelector('[data-tree]')?.getAttribute('aria-label')).toBe('Pages');
  });
});
