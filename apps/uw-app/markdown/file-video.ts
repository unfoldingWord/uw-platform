import type { Element, ElementContent, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

export type FileKind = 'image' | 'video';

export type KindOf = (id: string) => FileKind | null;
type Video = { readonly src: string; readonly name: string };

const FILE_ADDRESS =
  /^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const FILE_IN_TEXT =
  /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
const UNNAMED = 'the video';

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

function element(
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[] = [],
): Element {
  return { type: 'element', tagName, properties, children };
}

function videoOf(node: ElementContent | undefined, kindOf: KindOf): Video | null {
  if (node?.type !== 'element' || node.tagName !== 'img') return null;
  const src = node.properties['src'];
  const id = typeof src === 'string' ? fileIdOf(src) : null;
  if (id === null || typeof src !== 'string' || kindOf(id) !== 'video') return null;
  const alt = node.properties['alt'];
  return { src, name: typeof alt === 'string' && alt !== '' ? alt : UNNAMED };
}

function player(video: Video): Element {
  return element('video', {
    src: video.src,
    controls: true,
    preload: 'metadata',
    title: video.name,
  });
}

function downloadLink(video: Video): Element {
  return element('a', { href: video.src, download: true }, [
    { type: 'text', value: `Download ${video.name}` },
  ]);
}

function figureOf(video: Video): Element {
  return element('figure', { dataPageVideo: '' }, [
    player(video),
    element('figcaption', {}, [downloadLink(video)]),
  ]);
}

function soleVideo(paragraph: Element, kindOf: KindOf): Video | null {
  const meaningful = paragraph.children.filter(
    (child) => child.type !== 'text' || child.value.trim() !== '',
  );
  return meaningful.length === 1 ? videoOf(meaningful[0], kindOf) : null;
}

export function fileVideos(kindOf: KindOf) {
  return () =>
    (tree: Root): void => {
      visit(tree, 'element', (node, index, parent) => {
        if (parent === undefined || index === undefined) return undefined;
        const alone = node.tagName === 'p' ? soleVideo(node, kindOf) : null;
        if (alone !== null) {
          parent.children.splice(index, 1, figureOf(alone));
          return [SKIP, index + 1];
        }
        const inline = videoOf(node, kindOf);
        if (inline === null) return undefined;
        const space = { type: 'text' as const, value: ' ' };
        parent.children.splice(index, 1, player(inline), space, downloadLink(inline));
        return [SKIP, index + 3];
      });
    };
}
