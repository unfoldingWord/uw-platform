import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ListShape } from './list.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body>${markup}</body></html>`).window.document;
}

function reordered(document: Document): boolean {
  return [...document.querySelectorAll('[data-shape="list"] *')].some((node) =>
    (node.getAttribute('class') ?? '').split(' ').includes('lg:order-first'),
  );
}

describe('the list shape', () => {
  it('keeps the title above the list when there is no side panel', async () => {
    const document = await dom(jsx(ListShape, { head: { title: 'Pages' }, children: 'rows' }));
    expect(reordered(document)).toBe(false);
  });

  it('puts the list before the side panel when there is one', async () => {
    const shaped = jsx(ListShape, { head: { title: 'Pages' }, peek: 'panel', children: 'rows' });
    expect(reordered(await dom(shaped))).toBe(true);
  });
});
