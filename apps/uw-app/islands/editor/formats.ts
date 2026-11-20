import type { Editor } from '@tiptap/core';

type Run = (editor: Editor) => boolean;
type Format = {
  readonly run: Run;
  readonly active?: (editor: Editor) => boolean;
};

const TABLE = { rows: 3, cols: 3, withHeaderRow: true };

function callout(editor: Editor): boolean {
  if (editor.isActive('blockquote', { callout: 'note' })) {
    return editor.chain().focus().toggleBlockquote().run();
  }
  const quoted = editor.isActive('blockquote') || editor.chain().focus().setBlockquote().run();
  return quoted && editor.chain().focus().updateAttributes('blockquote', { callout: 'note' }).run();
}

const formatByName: Readonly<Record<string, Format>> = {
  bold: {
    run: (editor) => editor.chain().focus().toggleBold().run(),
    active: (editor) => editor.isActive('bold'),
  },
  italic: {
    run: (editor) => editor.chain().focus().toggleItalic().run(),
    active: (editor) => editor.isActive('italic'),
  },
  strike: {
    run: (editor) => editor.chain().focus().toggleStrike().run(),
    active: (editor) => editor.isActive('strike'),
  },
  code: {
    run: (editor) => editor.chain().focus().toggleCode().run(),
    active: (editor) => editor.isActive('code'),
  },
  highlight: {
    run: (editor) => editor.chain().focus().toggleHighlight().run(),
    active: (editor) => editor.isActive('highlight'),
  },
  heading2: {
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (editor) => editor.isActive('heading', { level: 2 }),
  },
  heading3: {
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    active: (editor) => editor.isActive('heading', { level: 3 }),
  },
  bullets: {
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
    active: (editor) => editor.isActive('bulletList'),
  },
  numbers: {
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    active: (editor) => editor.isActive('orderedList'),
  },
  checklist: {
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
    active: (editor) => editor.isActive('taskList'),
  },
  quote: {
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    active: (editor) => editor.isActive('blockquote', { callout: null }),
  },
  callout: { run: callout, active: (editor) => editor.isActive('blockquote', { callout: 'note' }) },
  details: { run: (editor) => editor.chain().focus().setDetails().run() },
  table: { run: (editor) => editor.chain().focus().insertTable(TABLE).run() },
  codeBlock: {
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    active: (editor) => editor.isActive('codeBlock'),
  },
  rule: { run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  undo: { run: (editor) => editor.chain().focus().undo().run() },
  redo: { run: (editor) => editor.chain().focus().redo().run() },
};

const formats: ReadonlyMap<string, Format> = new Map(Object.entries(formatByName));

export const formatNames: readonly string[] = [...formats.keys()];

export function applyFormat(editor: Editor, name: string): boolean {
  return formats.get(name)?.run(editor) ?? false;
}

export function isFormatActive(editor: Editor, name: string): boolean {
  return formats.get(name)?.active?.(editor) ?? false;
}
