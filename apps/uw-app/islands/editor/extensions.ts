import { mergeAttributes, Node, type Extensions, type NodeViewRendererProps } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';

const Callout = Blockquote.extend({
  addAttributes() {
    return {
      callout: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-callout'),
        renderHTML: (attributes) =>
          typeof attributes['callout'] === 'string'
            ? { 'data-callout': attributes['callout'] }
            : {},
      },
    };
  },
});

const PageEmbed = Node.create({
  name: 'pageEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-page-embed'),
        renderHTML: (attributes) => ({ 'data-page-embed': String(attributes['src'] ?? '') }),
      },
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title'),
        renderHTML: (attributes) => ({ 'data-title': String(attributes['title'] ?? '') }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-page-embed]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes)];
  },
});

const VIDEO = 'video';

function fileView(props: NodeViewRendererProps & { HTMLAttributes: Record<string, unknown> }) {
  const video = props.node.attrs['fileKind'] === VIDEO;
  const dom = document.createElement(video ? 'video' : 'img');
  for (const [name, value] of Object.entries(props.HTMLAttributes)) {
    if (value !== null && value !== undefined) dom.setAttribute(name, String(value));
  }
  if (video) {
    dom.setAttribute('controls', '');
    dom.setAttribute('preload', 'metadata');
    dom.setAttribute('title', String(props.node.attrs['alt'] ?? ''));
    dom.removeAttribute('alt');
  }
  return { dom };
}

const PageFile = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fileKind: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-file-kind'),
        renderHTML: (attributes) =>
          attributes['fileKind'] === VIDEO ? { 'data-file-kind': VIDEO } : {},
      },
    };
  },
  addNodeView() {
    return fileView;
  },
});

export function pageExtensions(options: { readonly history: boolean }): Extensions {
  return [
    StarterKit.configure({
      blockquote: false,
      underline: false,
      undoRedo: options.history ? {} : false,
      link: { openOnClick: false, autolink: true },
    }),
    Callout,
    PageEmbed,
    Highlight,
    PageFile.configure({ inline: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Details,
    DetailsSummary,
    DetailsContent,
  ];
}
