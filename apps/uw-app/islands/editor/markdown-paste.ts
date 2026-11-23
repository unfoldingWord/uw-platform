import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { editorHtml } from '../../markdown/editor-html.ts';

const BLOCK = /^ {0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|\|.*\|\s*$|-{3,}\s*$)/m;
const INLINE = /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]+`|\[\[[^\]\n]+\]\]/;
const FORMATTED =
  /<(h[1-6]|strong|b|em|i|u|s|del|ul|ol|li|table|blockquote|pre|a|img|hr|mark|code)[\s>/]/i;

function looksLikeMarkdown(text: string): boolean {
  return BLOCK.test(text) || INLINE.test(text);
}

function markdownIn(view: EditorView, event: ClipboardEvent): string | null {
  if (view.state.selection.$from.parent.type.spec.code === true) return null;
  const data = event.clipboardData;
  if (data === null) return null;
  const text = data.getData('text/plain');
  if (FORMATTED.test(data.getData('text/html'))) return null;
  return looksLikeMarkdown(text) ? text : null;
}

function pasteMarkdown(editor: Editor, view: EditorView, event: ClipboardEvent): boolean {
  const markdown = markdownIn(view, event);
  if (markdown === null) return false;
  return editor.chain().focus().insertContent(editorHtml(markdown)).run();
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  priority: 1000,
  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: { handlePaste: (view, event) => pasteMarkdown(editor, view, event) },
      }),
    ];
  },
});
