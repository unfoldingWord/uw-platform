import { describe, expect, it } from 'vitest';
import { EditorFrame } from './editor-frame.tsx';
import '../../islands/editor/extensions.ts';
import { formatNames } from '../../islands/editor/formats.ts';

describe('#175 every toolbar button names a format the editor applies', () => {
  it('offers no button the editor does not know', () => {
    const html = String(EditorFrame({ pageId: 'p1', bodyMd: '', draft: null }));
    const offered = [...html.matchAll(/data-format="([^"]+)"/g)].map((match) => match[1]);
    expect(offered.length).toBeGreaterThan(10);
    expect(offered.filter((name) => !formatNames.includes(name ?? ''))).toEqual([]);
  });
});
