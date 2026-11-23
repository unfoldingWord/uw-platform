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

const PLAYER_EVENTS = /^(mouse|pointer|drag|click|dblclick|contextmenu|touch|wheel)/;

function attributesOn(dom: HTMLElement, attributes: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) dom.setAttribute(name, String(value));
  }
}

function playerView(props: NodeViewRendererProps & { HTMLAttributes: Record<string, unknown> }) {
  const dom = document.createElement('video');
  attributesOn(dom, props.HTMLAttributes);
  dom.removeAttribute('alt');
  dom.setAttribute('controls', '');
  dom.setAttribute('preload', 'metadata');
  dom.setAttribute('title', String(props.node.attrs['alt'] ?? ''));
  dom.addEventListener('dragstart', (event) => event.preventDefault());
  return { dom, stopEvent: (event: Event) => PLAYER_EVENTS.test(event.type) };
}

function fileView(props: NodeViewRendererProps & { HTMLAttributes: Record<string, unknown> }) {
  if (props.node.attrs['fileKind'] === VIDEO) return playerView(props);
  const dom = document.createElement('img');
  attributesOn(dom, props.HTMLAttributes);
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
