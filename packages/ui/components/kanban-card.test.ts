import axe from 'axe-core';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { KanbanCard } from './kanban-card.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

const props = {
  title: 'Add the reorder command',
  href: '/items/42',
  meta: [
    { label: 'Stage', value: 'Build' },
    { label: 'Status', value: 'Held at the gate' },
  ],
};

describe('WB-11 the kanban card', () => {
  it('WB-11 a kanban card is an article whose title links to the item and whose facts are a description list', async () => {
    const document = await dom(jsx(KanbanCard, props));
    const article = document.querySelector('article');
    const link = article?.querySelector('h3 a');
    expect(link?.getAttribute('href')).toBe('/items/42');
    expect(link?.textContent).toBe('Add the reorder command');
    const terms = [...(article?.querySelectorAll('dl dt') ?? [])].map((term) => term.textContent);
    const values = [...(article?.querySelectorAll('dl dd') ?? [])].map(
      (value) => value.textContent,
    );
    expect(terms).toEqual(['Stage', 'Status']);
    expect(values).toEqual(['Build', 'Held at the gate']);
  });

  it('a kanban card link has visible focus', async () => {
    const markup = await jsx(KanbanCard, props).toString();
    expect(markup).toContain('focus-visible:outline-2');
    expect(markup).toContain('outline-focus');
  });

  it('a kanban card escapes its title and its facts', async () => {
    const document = await dom(
      jsx(KanbanCard, {
        title: '<img src=x onerror=alert(1)>',
        href: '/items/1',
        meta: [{ label: '<b>l</b>', value: '<i>v</i>' }],
      }),
    );
    expect(document.querySelector('img, b, i')).toBeNull();
    expect(document.querySelector('a')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('a kanban card with an unsafe href shows its title without a link', async () => {
    const document = await dom(jsx(KanbanCard, { ...props, href: 'javascript:alert(1)' }));
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('h3')?.textContent).toBe('Add the reorder command');
  });

  it('a kanban card without facts has no description list', async () => {
    const document = await dom(jsx(KanbanCard, { ...props, meta: [] }));
    expect(document.querySelector('dl')).toBeNull();
  });
});

describe('the kanban card actions', () => {
  it('a card renders its actions after its facts', async () => {
    const actions = jsx(
      'form',
      { 'aria-label': 'Claim' },
      jsx('button', { type: 'submit' }, 'Claim'),
    );
    const document = await dom(jsx(KanbanCard, { ...props, actions }));
    const article = document.querySelector('article');
    const form = article?.querySelector('form');
    expect(form?.textContent).toBe('Claim');
    const list = article?.querySelector('dl');
    expect(list?.compareDocumentPosition(form as Node)).toBe(
      document.defaultView?.Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe('the kanban card passes axe-core', () => {
  it('has no axe-core violations', async () => {
    const window = new JSDOM(
      `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><h2>Build</h2>${await jsx(KanbanCard, props).toString()}</main></body></html>`,
      { runScripts: 'outside-only' },
    ).window;
    window.eval(axe.source);
    const runner = (window as unknown as { axe: typeof axe }).axe;
    const results = await runner.run(window.document, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.passes.map((pass) => pass.id)).toEqual(
      expect.arrayContaining(['link-name', 'dlitem', 'definition-list']),
    );
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    window.close();
  });
});
