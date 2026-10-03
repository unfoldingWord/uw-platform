import axe from 'axe-core';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge.tsx';
import { Card } from './card.tsx';
import { Chip } from './chip.tsx';
import { EvidenceLabel } from './evidence-label.tsx';
import { Kpi } from './kpi.tsx';
import { Note } from './note.tsx';
import { Table } from './table.tsx';

async function html(element: ReturnType<typeof jsx>): Promise<string> {
  return await element.toString();
}

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await html(element);
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'amount', label: 'Amount', numeric: true },
];
const rows = [
  { name: 'Alpha', amount: '$1.00' },
  { name: 'Beta', amount: '$2.00' },
];

describe('WB-11 the card', () => {
  it('WB-11 a card with a title renders a heading and its children, and escapes both', async () => {
    const document = await dom(jsx(Card, { title: '<b>t</b>', children: '<i>x</i>' }));
    expect(document.querySelector('h2')?.textContent).toBe('<b>t</b>');
    expect(document.querySelector('b, i')).toBeNull();
  });

  it('a card without a title has no heading', async () => {
    const document = await dom(jsx(Card, { children: 'x' }));
    expect(document.querySelector('h2')).toBeNull();
  });
});

describe('WB-11 the badge', () => {
  const expected = {
    neutral: 'bg-bg text-muted border border-line',
    info: 'bg-inspire-soft text-ocean',
    success: 'bg-cultivate-soft text-ink',
    held: 'bg-surface text-muted border border-dashed border-line',
  } as const;

  it.each(Object.entries(expected))(
    'WB-11 the %s badge uses only its token classes and carries text',
    async (tone, classes) => {
      const markup = await html(
        jsx(Badge, { tone: tone as keyof typeof expected, children: 'Held' }),
      );
      expect(markup).toContain(classes);
      expect(markup).toContain('>Held<');
      expect(markup).not.toMatch(/red|#[0-9a-f]{3}/i);
    },
  );
});

describe('WB-11 the chip', () => {
  it('WB-11 a chip with an href is a link named by its label', async () => {
    const document = await dom(jsx(Chip, { label: 'Open', href: '/items?state=open' }));
    const link = document.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/items?state=open');
    expect(link?.textContent).toBe('Open');
  });

  it('a selected link chip says so with aria-current, not colour alone', async () => {
    const document = await dom(jsx(Chip, { label: 'Open', href: '/x', selected: true }));
    expect(document.querySelector('a')?.getAttribute('aria-current')).toBe('true');
  });

  it('WB-11 a chip without an href is a button whose aria-pressed reflects selected', async () => {
    const on = await dom(jsx(Chip, { label: 'Open', selected: true }));
    const off = await dom(jsx(Chip, { label: 'Open' }));
    expect(on.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(off.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
    expect(on.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it('a chip with an unsafe href is a button, never a link', async () => {
    const document = await dom(jsx(Chip, { label: 'x', href: 'javascript:alert(1)' }));
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('button')).not.toBeNull();
  });

  it('every chip has visible focus', async () => {
    const markup = await html(jsx(Chip, { label: 'x' }));
    expect(markup).toContain('focus-visible:outline-2');
    expect(markup).toContain('outline-focus');
  });
});

describe('WB-11 the table', () => {
  it('WB-11 a table has a caption, column headers with scope, and a wrapper that scrolls at phone width', async () => {
    const document = await dom(jsx(Table, { caption: 'Spend', columns, rows }));
    expect(document.querySelector('caption')?.textContent).toBe('Spend');
    const headers = [...document.querySelectorAll('thead th')];
    expect(headers.map((th) => [th.textContent, th.getAttribute('scope')])).toEqual([
      ['Name', 'col'],
      ['Amount', 'col'],
    ]);
    expect(document.querySelector('table')?.parentElement?.getAttribute('class')).toContain(
      'overflow-x-auto',
    );
    expect([...document.querySelectorAll('tbody tr')]).toHaveLength(2);
  });

  it('WB-11 numeric columns are right-aligned and monospaced in the header and every cell', async () => {
    const document = await dom(jsx(Table, { caption: 'Spend', columns, rows }));
    const numeric = [
      document.querySelector('thead th:nth-child(2)'),
      ...document.querySelectorAll('tbody td:nth-child(2)'),
    ];
    for (const cell of numeric) {
      expect(cell?.getAttribute('class')).toContain('text-right');
      expect(cell?.getAttribute('class')).toContain('font-mono');
    }
    expect(document.querySelector('tbody td:nth-child(1)')?.getAttribute('class')).not.toContain(
      'font-mono',
    );
  });

  it('a missing cell renders empty and cell text is escaped', async () => {
    const document = await dom(
      jsx(Table, { caption: '<b>c</b>', columns, rows: [{ name: '<i>x</i>' }] }),
    );
    expect(document.querySelector('i, b')).toBeNull();
    expect(document.querySelector('tbody td:nth-child(2)')?.textContent).toBe('');
    expect(document.querySelector('caption')?.textContent).toBe('<b>c</b>');
  });

  it('a row key that is an inherited property name reads as missing', async () => {
    const document = await dom(
      jsx(Table, { caption: 'c', columns: [{ key: 'constructor', label: 'C' }], rows: [{}] }),
    );
    expect(document.querySelector('tbody td')?.textContent).toBe('');
  });
});

describe('WB-11 the KPI', () => {
  it('WB-11 a KPI renders its label as a term and its value as the definition a screen reader reads', async () => {
    const document = await dom(
      jsx(Kpi, { label: 'Open gates', value: '12', detail: 'since Monday' }),
    );
    expect(document.querySelector('dt')?.textContent).toBe('Open gates');
    const definitions = [...document.querySelectorAll('dd')].map((dd) => dd.textContent);
    expect(definitions).toEqual(['12', 'since Monday']);
    expect(document.querySelector('dl')).not.toBeNull();
  });

  it('a KPI without a detail has one definition', async () => {
    const document = await dom(jsx(Kpi, { label: 'a', value: '1' }));
    expect(document.querySelectorAll('dd')).toHaveLength(1);
  });
});

describe('WB-11 the note', () => {
  it('WB-11 a note has role note and escapes its text', async () => {
    const document = await dom(jsx(Note, { children: '<b>x</b>' }));
    expect(document.querySelector('[role="note"]')?.textContent).toBe('<b>x</b>');
    expect(document.querySelector('b')).toBeNull();
  });
});

describe('WB-11 the evidence label', () => {
  it.each([
    ['observed', 'Seen directly in a system or a record.'],
    ['confirmed', 'Checked by a person or a second source.'],
    ['inferred', 'Concluded from other evidence, not seen directly.'],
    ['assumed', 'Taken as true with no evidence yet.'],
  ] as const)(
    'WB-11 %s renders its word with a sentence-case definition as its title',
    async (label, title) => {
      const document = await dom(jsx(EvidenceLabel, { label }));
      const element = document.querySelector('[title]');
      expect(element?.textContent).toBe(label);
      expect(element?.getAttribute('title')).toBe(title);
    },
  );
});

describe('the content pieces pass axe-core', () => {
  it('has no axe-core violations across every piece', async () => {
    const parts = [
      jsx(Card, { title: 'Card', children: jsx(Note, { children: 'A note.' }) }),
      jsx(Badge, { tone: 'held', children: 'Held' }),
      jsx(Chip, { label: 'Open', href: '/x', selected: true }),
      jsx(Chip, { label: 'Closed', selected: false }),
      jsx(Table, { caption: 'Spend', columns, rows }),
      jsx(Kpi, { label: 'Open gates', value: '12', detail: 'since Monday' }),
      jsx(EvidenceLabel, { label: 'observed' }),
    ];
    const markup = (await Promise.all(parts.map(html))).join('');
    const window = new JSDOM(
      `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main>${markup}</main></body></html>`,
      { runScripts: 'outside-only' },
    ).window;
    window.eval(axe.source);
    const runner = (window as unknown as { axe: typeof axe }).axe;
    const results = await runner.run(window.document, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.passes.map((pass) => pass.id)).toEqual(
      expect.arrayContaining(['th-has-data-cells', 'scope-attr-valid', 'link-name', 'button-name']),
    );
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    window.close();
  });
});
