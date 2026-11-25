import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ListRow, RowList } from './list-row.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

describe('the list row', () => {
  it('reveals its actions on hover and focus, and keeps them shown while one is open', async () => {
    const document = await dom(
      jsx(RowList, {
        label: 'Properties',
        children: jsx(ListRow, {
          title: 'Owner',
          meta: 'A person',
          actions: jsx('details', { children: jsx('summary', { children: 'Remove' }) }),
        }),
      }),
    );
    const actions = document.querySelector('details')?.parentElement;
    const look = actions?.getAttribute('class') ?? '';
    expect(look).toContain('opacity-0');
    expect(look).toContain('group-hover/row:opacity-100');
    expect(look).toContain('group-focus-within/row:opacity-100');
    expect(look).toContain('has-open:opacity-100');
  });
});
