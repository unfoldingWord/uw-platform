import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render.ts';
import { placedPanels } from './panel-embeds.ts';

const block = (kind: string) =>
  `\`\`\`panel\nkind: ${kind}\nmeasure: c0110000-0000-4000-8000-000000000001\n\`\`\`\n`;

describe('ADR 0034 a panel block renders as a placeholder the page fills for each reader', () => {
  it('numbers each panel block in order and keeps its text inside, so the cache holds no figure', () => {
    const { html } = renderMarkdown(`Intro.\n\n${block('status')}\n${block('status')}`);
    const placed = placedPanels(html);
    expect(placed.map((each) => each.index)).toEqual([0, 1]);
    expect(html).toContain(
      '<div data-panel-block="0"><pre><code class="language-panel">kind: status',
    );
  });

  it('marks the blocks of an embedded page with that page, numbered within it', () => {
    const embedded = 'd0000000-0000-4000-8000-000000000001';
    const hooks = {
      linkTitle: () => null,
      wiki: () => null,
      fileKind: () => null,
      embed: () => ({ kind: 'page' as const, title: 'Card', bodyMd: block('status') }),
    };
    const { html } = renderMarkdown(`${block('status')}\n![Card](/pages/${embedded})\n`, hooks);
    expect(placedPanels(html)).toEqual([
      expect.objectContaining({ index: 0, pageId: null }),
      expect.objectContaining({ index: 0, pageId: embedded }),
    ]);
  });

  it('leaves other code blocks alone', () => {
    const { html } = renderMarkdown('```yaml\nkind: status\n```\n');
    expect(placedPanels(html)).toEqual([]);
    expect(html).not.toContain('data-panel-block');
  });

  it('never trusts a hand-written placeholder in raw HTML', () => {
    const { html } = renderMarkdown('<div data-panel-block="0">forged</div>\n');
    expect(placedPanels(html)).toEqual([]);
  });
});
