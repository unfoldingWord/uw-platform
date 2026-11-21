import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render.ts';

const LARGEST_KNOWN_PAGE = 170_000;
const BUDGET_MS = 10_000;

function longPage(): string {
  const section = [
    '## Meeting',
    '',
    '<details>',
    '<summary>New topics</summary>',
    '',
    '- Program cards need to be **completed** by [the owner](/pages/3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11).',
    '- [ ] Review the closure report',
    '',
    '</details>',
    '',
    '| Item | Count |',
    '|---|---|',
    '| Laptop | 2 |',
    '',
  ].join('\n');
  return section.repeat(Math.ceil(LARGEST_KNOWN_PAGE / section.length));
}

describe('#175 the largest page seen in the Notion workspace renders in time', () => {
  it('renders 170,000 characters of mixed markdown without stalling, even on a slow machine', () => {
    const source = longPage();
    expect(source.length).toBeGreaterThanOrEqual(LARGEST_KNOWN_PAGE);
    const started = performance.now();
    const rendered = renderMarkdown(source);
    const took = performance.now() - started;
    expect(rendered.headings.length).toBeGreaterThan(500);
    expect(took).toBeLessThan(BUDGET_MS);
  });
});
