import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark';
import type { SlashItem } from './crepe-editor.ts';

const LINK_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.6 13.4a1 1 0 0 1 0-1.4l3-3a1 1 0 1 1 1.4 1.4l-3 3a1 1 0 0 1-1.4 0ZM7 17a4 4 0 0 1-2.8-6.8l2.5-2.5a1 1 0 0 1 1.4 1.4l-2.5 2.5A2 2 0 1 0 8.4 14.4l2.5-2.5a1 1 0 0 1 1.4 1.4l-2.5 2.5A4 4 0 0 1 7 17Zm8.3-1.3a1 1 0 0 1-1.4-1.4l2.5-2.5a2 2 0 1 0-2.8-2.8l-2.5 2.5a1 1 0 1 1-1.4-1.4l2.5-2.5a4 4 0 1 1 5.6 5.6l-2.5 2.5Z"/></svg>';
const FILE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5H9v9a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v11.5a6 6 0 0 0 12 0v-10h-1.5Z"/></svg>';

function clearTyped(ctx: Ctx): void {
  ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
}

export function pageSlashItems(pickFile: () => void): readonly SlashItem[] {
  return [
    {
      key: 'page-link',
      label: 'Link to a page',
      icon: LINK_ICON,
      run: (ctx) => {
        clearTyped(ctx);
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.insertText('[['));
      },
    },
    {
      key: 'page-file',
      label: 'Picture or file',
      icon: FILE_ICON,
      run: (ctx) => {
        clearTyped(ctx);
        pickFile();
      },
    },
  ];
}
