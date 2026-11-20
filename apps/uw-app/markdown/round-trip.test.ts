import { describe, expect, it } from 'vitest';
import { editorHtml } from './editor-html.ts';
import { markdownFromEditor } from './from-editor.ts';
import { renderMarkdown } from './render.ts';
import { roundTripSamples } from './round-trip-samples.ts';

const there = (markdown: string): string => markdownFromEditor(editorHtml(markdown));

describe('#175 markdown survives the trip to the editor and back', () => {
  it.each(roundTripSamples)('keeps $name exactly as written', ({ markdown }) => {
    expect(there(markdown)).toBe(markdown);
  });

  it('settles after one trip, so a second save changes nothing', () => {
    const loose = '* one\n* two\n\nSome __bold__ and _soft_ text.\n\n***\n';
    const once = there(loose);
    expect(there(once)).toBe(once);
    expect(renderMarkdown(once).html).toBe(renderMarkdown(loose).html);
  });

  it('shapes a checklist, a collapsible section and an embed the way the editor reads them', () => {
    const html = editorHtml(
      '- [x] done\n- [ ] open\n\n<details>\n<summary>More</summary>\n\nInside.\n\n</details>\n\n![Budget](/pages/3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11#rates)',
    );
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-type="taskItem" data-checked="true">');
    expect(html).toContain('<div data-type="detailsContent"><p>Inside.</p>');
    expect(html).toContain(
      '<div data-page-embed="/pages/3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11#rates" data-title="Budget"></div>',
    );
  });
});
