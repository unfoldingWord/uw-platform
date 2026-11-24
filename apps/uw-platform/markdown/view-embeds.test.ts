import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render.ts';
import { placedViews, viewAddress } from './view-embeds.ts';

const viewId = 'c0110000-0000-4000-8000-000000000401';

describe('#206 a saved view is embedded by an image link to it', () => {
  it('reads a view address and nothing else', () => {
    expect(viewAddress(`/collections/program/views/${viewId}`)).toEqual({
      collection: 'program',
      viewId,
    });
    expect(viewAddress(`/collections/Program/views/${viewId}`)).toBeNull();
    expect(viewAddress('/pages/x')).toBeNull();
  });

  it('renders a placeholder carrying no rows, so the cached page holds no data', () => {
    const { html } = renderMarkdown(
      `Programs:\n\n![By phase](/collections/program/views/${viewId})\n`,
    );
    expect(html).toContain(
      `<div data-view-embed="${viewId}" data-collection="program"><a href="/collections/program/views/${viewId}">By phase</a></div>`,
    );
    expect(placedViews(html)).toEqual([expect.objectContaining({ viewId, collection: 'program' })]);
  });

  it('leaves an image inside a sentence alone', () => {
    const { html } = renderMarkdown(`See ![x](/collections/program/views/${viewId}) here.`);
    expect(placedViews(html)).toEqual([]);
  });
});
