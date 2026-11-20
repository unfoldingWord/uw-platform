import { mergeAttributes, Node, type Extensions } from '@tiptap/core';
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
    Image.configure({ inline: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Details,
    DetailsSummary,
    DetailsContent,
  ];
}
