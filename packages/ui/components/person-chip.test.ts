import axe from 'axe-core';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { PersonChip, initialsOf } from './person-chip.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

function chip(person: { readonly name: string; readonly href?: string }) {
  return jsx(PersonChip, { person });
}

async function violations(element: ReturnType<typeof jsx>): Promise<readonly string[]> {
  const markup = await element.toString();
  const window = new JSDOM(
    `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main>${markup}</main></body></html>`,
    { runScripts: 'outside-only' },
  ).window;
  window.eval(axe.source);
  const runner = (window as unknown as { axe: typeof axe }).axe;
  const results = await runner.run(window.document, {
    rules: { 'color-contrast': { enabled: false } },
  });
  window.close();
  return results.violations.map((violation) => violation.id);
}

describe('the person chip', () => {
  it('links to the person page with the display name as its accessible name', async () => {
    const element = chip({ name: 'Avery Stone', href: '/collections/directory/rows/abc' });
    const document = await dom(element);
    const link = document.querySelector('a[data-person-chip]');
    expect(link?.getAttribute('href')).toBe('/collections/directory/rows/abc');
    expect(link?.textContent).toContain('Avery Stone');
    expect(link?.querySelector('[aria-hidden="true"]')?.textContent).toBe('AS');
    expect(await violations(element)).toEqual([]);
  });

  it('shows the name with no link when the reader may not open the person page', async () => {
    const document = await dom(chip({ name: 'Avery Stone' }));
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('[data-person-chip]')?.textContent).toContain('Avery Stone');
  });

  it('drops an unsafe address rather than linking to it', async () => {
    const document = await dom(chip({ name: 'Avery Stone', href: 'javascript:alert(1)' }));
    expect(document.querySelector('a')).toBeNull();
  });

  it('takes initials from the first two words of the name', () => {
    expect(initialsOf('Avery Stone')).toBe('AS');
    expect(initialsOf('avery.stone')).toBe('AS');
    expect(initialsOf('Avery')).toBe('A');
    expect(initialsOf('Avery Jo Stone')).toBe('AJ');
    expect(initialsOf('')).toBe('?');
  });
});
