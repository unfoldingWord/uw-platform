import type { Element, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

export type FileKind = 'image' | 'video';

const FILE_ADDRESS =
  /^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const FILE_IN_TEXT =
  /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

function fileIdOf(url: string): string | null {
  return FILE_ADDRESS.exec(url)?.[1] ?? null;
}

export function fileIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(FILE_IN_TEXT)].map((found) => found[1] ?? ''))];
}

export function kindOfContentType(contentType: string): FileKind | null {
  if (contentType.startsWith('video/')) return 'video';
  return contentType.startsWith('image/') ? 'image' : null;
}

function video(src: string, alt: string): Element {
  const name = alt === '' ? 'Download the video' : alt;
  const fallback: Element = {
    type: 'element',
    tagName: 'a',
    properties: { href: src },
    children: [{ type: 'text', value: name }],
  };
  return {
    type: 'element',
    tagName: 'video',
    properties: { src, controls: true, preload: 'metadata', title: alt === '' ? undefined : alt },
    children: [fallback],
  };
}

export function fileMedia(kindOf: (id: string) => FileKind | null) {
  return () =>
    (tree: Root): void => {
      visit(tree, 'element', (node, index, parent) => {
        if (node.tagName !== 'img' || parent === undefined || index === undefined) return undefined;
        const src = node.properties['src'];
        const id = typeof src === 'string' ? fileIdOf(src) : null;
        if (id === null || typeof src !== 'string' || kindOf(id) !== 'video') return undefined;
        const alt = node.properties['alt'];
        parent.children.splice(index, 1, video(src, typeof alt === 'string' ? alt : ''));
        return [SKIP, index + 1];
      });
    };
}
