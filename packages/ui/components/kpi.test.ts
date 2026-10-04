import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { Kpi } from './kpi.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

describe('the KPI tone', () => {
  it('a KPI with a tone shows its value as a badge of that tone', async () => {
    const document = await dom(jsx(Kpi, { label: 'Spend', value: 'Watch', tone: 'held' }));
    const value = document.querySelector('dd');
    const badge = value?.querySelector('span');
    expect(badge?.textContent).toBe('Watch');
    expect(badge?.getAttribute('class')).toContain('border-dashed');
  });

  it('a KPI without a tone shows its value as plain text', async () => {
    const document = await dom(jsx(Kpi, { label: 'Spend', value: '$12.00' }));
    expect(document.querySelector('dd')?.textContent).toBe('$12.00');
    expect(document.querySelector('dd span')).toBeNull();
  });
});
