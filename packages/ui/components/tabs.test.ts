import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { Tabs } from './tabs.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body>${markup}</body></html>`).window.document;
}

describe('the tabs', () => {
  it('#106 a tab shows how many things wait on the viewer, and nothing when none wait', async () => {
    const document = await dom(
      jsx(Tabs, {
        tabs: [
          { label: 'Queue', href: '/q', current: true },
          { label: 'Waiting On You', href: '/w', current: false, count: 2 },
          { label: 'Flow', href: '/f', current: false, count: 0 },
        ],
      }),
    );
    const tabs = [...document.querySelectorAll('nav[aria-label="Views"] a')];
    expect(tabs.map((tab) => tab.querySelector('[data-count]')?.textContent ?? null)).toEqual([
      null,
      '2',
      null,
    ]);
    expect(tabs[1]?.getAttribute('aria-label')).toBe('Waiting On You, 2 waiting');
    expect(tabs[0]?.getAttribute('aria-current')).toBe('page');
  });
});
