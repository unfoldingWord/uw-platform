import { describe, expect, it } from 'vitest';
import { EditorFrame } from './editor-frame.tsx';

describe('#175 the editor frame carries only what the editor mounts on', () => {
  it('offers the surface, the page picker and the draft room, and no toolbar of its own', () => {
    const html = String(
      EditorFrame({
        pageId: 'p1',
        draft: { version: 3, person: 'ana@uw.example' },
        styleNonce: 'bm9uY2U=',
      }),
    );
    expect(html).toContain('data-editor-surface');
    expect(html).toContain('data-editor-menu');
    expect(html).toContain('data-draft-version="3"');
    expect(html).not.toContain('data-format');
    expect(html).not.toContain('data-editor-content');
  });
});
