import type { Editor } from '@tiptap/core';

const VIDEO = 'video';

export function videoFilesOf(root: Element): ReadonlySet<string> {
  const listed = root.getAttribute('data-video-files') ?? '';
  return new Set(listed.split(' ').filter((url) => url !== ''));
}

export function markVideos(editor: Editor, videos: ReadonlySet<string>): void {
  if (videos.size === 0) return;
  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    const src = node.attrs['src'];
    if (node.type.name !== 'image' || node.attrs['fileKind'] === VIDEO) return;
    if (typeof src !== 'string' || !videos.has(src)) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, fileKind: VIDEO });
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false));
}
