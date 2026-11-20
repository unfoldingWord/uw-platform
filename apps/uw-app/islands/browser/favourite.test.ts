import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireFavourite } from './favourite.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function page() {
  return new JSDOM(
    '<main><button data-favourite="p1" aria-pressed="false"><span>Favourite</span></button></main>',
  ).window.document;
}

describe('#175 a reader marks a page as a favourite from its read view', () => {
  it('keeps the favourite, then drops it, and shows which it is', async () => {
    const document = page();
    const sent: string[] = [];
    wireFavourite(document, (input, init) => {
      sent.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return Promise.resolve(Response.json({ status: 'accepted' }));
    });
    const button = document.querySelector('button');
    document.querySelector('span')?.click();
    await tick();
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.hasAttribute('data-on')).toBe(true);
    button?.click();
    await tick();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(sent).toEqual(['PUT /api/pages/p1/favourite', 'DELETE /api/pages/p1/favourite']);
  });

  it('leaves the control as it was when the change is refused', async () => {
    const document = page();
    wireFavourite(document, () => Promise.resolve(new Response('no', { status: 404 })));
    document.querySelector('button')?.click();
    await tick();
    expect(document.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
  });
});
