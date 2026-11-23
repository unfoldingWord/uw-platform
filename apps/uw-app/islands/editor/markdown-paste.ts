import { Extension, type Editor, type JSONContent, type Range } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { pastedMarkdownReplySchema } from '@uw/contracts';

const CONVERT = '/api/pages/editor-html';
const BLOCK = /^ {0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|\|.*\|\s*$|-{3,}\s*$)/m;
const INLINE = /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]+`|\[\[[^\]\n]+\]\]/;
const FORMATTED =
  /<(h[1-6]|strong|b|em|i|u|s|del|ul|ol|li|table|blockquote|pre|a|img|hr|mark|code)[\s>/]/i;

type Send = typeof fetch;

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

function asParagraphs(text: string): JSONContent[] {
  return text.split(/\r?\n+/).map((line) => ({
    type: 'paragraph',
    content: line === '' ? [] : [{ type: 'text', text: line }],
  }));
}

async function converted(send: Send, markdown: string): Promise<string | null> {
  try {
    const response = await send(CONVERT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    if (!response.ok) return null;
    return pastedMarkdownReplySchema.parse(await response.json()).html;
  } catch {
    return null;
  }
}

function pasteMarkdown(editor: Editor, send: Send, view: EditorView, event: ClipboardEvent) {
  const markdown = markdownIn(view, event);
  if (markdown === null) return false;
  const before = view.state.doc;
  const { from, to } = view.state.selection;
  void converted(send, markdown).then((html) => {
    if (editor.isDestroyed) return;
    const at: Range | number =
      editor.state.doc === before ? { from, to } : editor.state.selection.from;
    editor
      .chain()
      .focus()
      .insertContentAt(at, html ?? asParagraphs(markdown))
      .run();
  });
  return true;
}

export const MarkdownPaste = Extension.create<{ readonly fetch: Send }>({
  name: 'markdownPaste',
  priority: 1000,
  addOptions() {
    return { fetch: (input, init) => fetch(input, init) };
  },
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste: (view, event) => pasteMarkdown(editor, options.fetch, view, event),
        },
      }),
    ];
  },
});
