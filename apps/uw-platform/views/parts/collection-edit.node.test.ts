import { readFileSync } from 'node:fs';
import { propertyDefinitionSchema } from '@uw/contracts';
import { buttonClass } from '@uw/ui/components/button.tsx';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { PropertyEditor } from './collection-edit.tsx';

const property = propertyDefinitionSchema.parse(
  JSON.parse(
    readFileSync('packages/contracts/fixtures/property-definition/valid/example-1.json', 'utf8'),
  ),
);

async function editor(compact: boolean): Promise<Document> {
  const target = {
    collection: 'projects',
    rowId: 'row-1',
    rowTitle: 'Ruth',
    property,
    value: 'idea',
    compact,
    people: [],
    rows: [],
  };
  const markup = await jsx(PropertyEditor, { target }).toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

describe('a property editor in a table cell', () => {
  it('keeps its Save off screen until a keyboard reaches it, then shows the Button part', async () => {
    const document = await editor(true);
    const save = document.querySelector('button[type="submit"]');
    expect(save?.getAttribute('aria-label')).toBe('Save Phase of Ruth');
    expect(save?.getAttribute('class')).toBe(buttonClass('human', 'sm'));
    const holder = save?.parentElement?.getAttribute('class') ?? '';
    expect(holder).toContain('sr-only');
    expect(holder).toContain('focus-within:not-sr-only');
  });
});
