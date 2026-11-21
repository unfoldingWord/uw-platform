import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render.ts';

const html = (source: string): string => renderMarkdown(source).html;

describe('a page body renders as GitHub-flavoured markdown', () => {
  it('renders headings, emphasis, lists, links and code', () => {
    const out = html('## Rules\n\nUse **strong** passwords.\n\n- one\n- two\n\n`code`');
    expect(out).toContain('<h2 id="rules">Rules</h2>');
    expect(out).toContain('<strong>strong</strong>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<code>code</code>');
  });

  it('renders a table with its header row, and a checklist that cannot be ticked', () => {
    const table = html('| Program | Rate |\n|---|---|\n| Laptop | 2 |');
    expect(table).toContain('<th>Program</th>');
    expect(table).toContain('<td>2</td>');
    const list = html('- [ ] open\n- [x] done');
    expect(list).toContain('type="checkbox"');
    expect(list.match(/disabled/g)?.length).toBe(2);
    expect(list).toContain('checked');
  });

  it('keeps a fenced code block as written, markup included', () => {
    const out = html('```\n<script>alert(1)</script>\n```');
    expect(out).toContain('&#x3C;script>alert(1)&#x3C;/script>');
    expect(out).not.toContain('<script>');
  });
});

describe('the dialect adds callouts, collapsible sections and highlights', () => {
  it('turns an alert blockquote into a named callout', () => {
    const out = html('> [!WARNING]\n> Do not move any rows.');
    expect(out).toContain('data-callout="warning"');
    expect(out).toContain('Do not move any rows.');
    expect(out).not.toContain('[!WARNING]');
  });

  it('leaves an ordinary blockquote, and one with an unknown label, as a quote', () => {
    expect(html('> A quote.')).not.toContain('data-callout');
    const unknown = html('> [!SHOUT]\n> Text.');
    expect(unknown).not.toContain('data-callout');
    expect(unknown).toContain('[!SHOUT]');
  });

  it('keeps details and summary, with markdown inside', () => {
    const out = html(
      '<details>\n<summary>Change log</summary>\n\n- 2025-07-01 moved\n\n</details>',
    );
    expect(out).toContain('<details>');
    expect(out).toContain('<summary>Change log</summary>');
    expect(out).toContain('<li>2025-07-01 moved</li>');
  });

  it('marks ==text== as a highlight, but not inside code', () => {
    expect(html('Row 30 is ==always the income==.')).toContain('<mark>always the income</mark>');
    expect(html('`a ==b== c`')).not.toContain('<mark>');
  });
});

describe('a page body cannot carry active content', () => {
  it('drops scripts, event handlers, frames, forms and styles', () => {
    const out = html(
      '<script>x()</script>\n\n<p onclick="x()">hi</p>\n\n<iframe src="https://a.test"></iframe>\n\n<form action="/x"><input name="a"></form>\n\n<style>p{}</style>',
    );
    expect(out).not.toMatch(/<script|onclick|<iframe|<form|<style|name="a"/);
    expect(out).toContain('hi');
  });

  it('drops a javascript: link target and keeps http, mailto and in-app links', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('javascript:');
    expect(html('[x](https://unfoldingword.org)')).toContain('href="https://unfoldingword.org"');
    expect(html('[x](mailto:it@unfoldingword.org)')).toContain(
      'href="mailto:it@unfoldingword.org"',
    );
    expect(html('[x](/pages/3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11)')).toContain(
      'href="/pages/3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11"',
    );
  });

  it('does not let a page take an id the screen uses, or set a class', () => {
    const out = html('<h2 id="main">Mine</h2>\n\n<p class="fixed inset-0">cover</p>');
    expect(out).not.toContain('id="main"');
    expect(out).not.toContain('class=');
  });

  it('opens an outside link without handing over the opener', () => {
    expect(html('[x](https://example.org)')).toContain('rel="noopener noreferrer"');
    expect(html('[x](/pages/abc)')).not.toContain('rel=');
  });
});

describe('the table of contents comes from the headings', () => {
  it('lists second and third level headings with the ids the body carries', () => {
    const { headings, html: out } = renderMarkdown(
      '# Title\n\n## One\n\n### Inner\n\n#### Deep\n\n## Two',
    );
    expect(headings).toEqual([
      { depth: 2, id: 'one', text: 'One' },
      { depth: 3, id: 'inner', text: 'Inner' },
      { depth: 2, id: 'two', text: 'Two' },
    ]);
    expect(out).toContain('<h3 id="inner">Inner</h3>');
  });

  it('gives two headings with the same words different ids', () => {
    const { headings } = renderMarkdown('## Rules\n\n## Rules');
    expect(headings.map((heading) => heading.id)).toEqual(['rules', 'rules-1']);
  });
});
