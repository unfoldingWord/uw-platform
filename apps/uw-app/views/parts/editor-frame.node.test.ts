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

describe('#214 the editor content marks a video page file by its stored type', () => {
  it('tags the video for the editor and leaves the picture as it is', () => {
    const video = '00000000-0000-4000-8000-0000000000a1';
    const image = '00000000-0000-4000-8000-0000000000a2';
    const bodyMd = `![Walkthrough](/api/files/${video})\n\n![Settings](/api/files/${image})`;
    const videos = new Set([video]);
    const html = String(EditorFrame({ pageId: 'p1', bodyMd, draft: null, videos }));
    expect(html).toContain(`data-video-files="/api/files/${video}"`);
    expect(html).toContain(
      `<img src="/api/files/${video}" alt="Walkthrough" data-file-kind="video">`,
    );
    expect(html).toContain(`<img src="/api/files/${image}" alt="Settings">`);
  });
});
