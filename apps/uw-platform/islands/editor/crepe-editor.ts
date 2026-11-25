import { EditorView } from '@codemirror/view';
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { imageBlock } from '@milkdown/crepe/feature/image-block';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { history } from '@milkdown/kit/plugin/history';
import { codeLanguages } from './languages.ts';
import { alignsTableCells, copiesTableAlignment } from './table-align.ts';
import { wikiText, writesWikiText } from './wiki-text.ts';

export type SlashItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly run: (ctx: Ctx) => void;
};

export type PageEditorOptions = {
  readonly root: HTMLElement;
  readonly markdown: string;
  readonly styleNonce?: string;
  readonly upload: (file: File) => Promise<string>;
  readonly slashItems: readonly SlashItem[];
  readonly plugins: readonly MilkdownPlugin[];
};

function writeLikeThePages(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    bullet: '-' as const,
    rule: '-' as const,
  }));
}

export function pageEditor(options: PageEditorOptions): CrepeBuilder {
  const builder = new CrepeBuilder({ root: options.root, defaultValue: options.markdown })
    .addFeature(cursor)
    .addFeature(listItem)
    .addFeature(linkTooltip)
    .addFeature(imageBlock, { onUpload: options.upload })
    .addFeature(blockEdit, {
      buildMenu: (builder) => {
        const group = builder.addGroup('page', 'Page');
        for (const item of options.slashItems) {
          group.addItem(item.key, { label: item.label, icon: item.icon, onRun: item.run });
        }
      },
    })
    .addFeature(toolbar)
    .addFeature(placeholder, { text: 'Enter page body here...' })
    .addFeature(table)
    .addFeature(codeMirror, {
      languages: [...codeLanguages],
      extensions: options.styleNonce ? [EditorView.cspNonce.of(options.styleNonce)] : [],
    });
  builder.editor
    .config(writeLikeThePages)
    .config(writesWikiText)
    .config(alignsTableCells)
    .use([...wikiText, copiesTableAlignment, ...options.plugins]);
  return builder;
}

export async function sharedHistory(builder: CrepeBuilder): Promise<void> {
  await builder.editor.remove(history);
}
