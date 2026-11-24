import type { Ctx } from '@milkdown/kit/ctx';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { PageIndexEntry } from '@uw/contracts';
import type { Matcher } from '../browser/switcher-match.ts';
import type { Menu, MenuItem, Place } from './menu.ts';
import { wikiTextNode } from './wiki-text.ts';

export type PickerDeps = {
  readonly menu: Menu;
  readonly pages: () => Matcher;
};

type Typed = { readonly from: number; readonly to: number; readonly query: string };

const SHOWN = 8;
const OPENED = /\[\[([^\][\n]*)$/;

function typedAt(view: EditorView): Typed | null {
  const { $from, empty } = view.state.selection;
  if (!empty || $from.parent.type.spec.code === true) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = OPENED.exec(before);
  if (match === null) return null;
  return { from: $from.pos - match[0].length, to: $from.pos, query: match[1] ?? '' };
}

function placeOf(view: EditorView, at: number): Place | null {
  try {
    const { left, bottom } = view.coordsAtPos(at);
    return { left, bottom };
  } catch {
    return null;
  }
}

function linkTo(view: EditorView, typed: Typed, page: PageIndexEntry): void {
  const { schema } = view.state;
  const link = schema.marks['link']?.create({ href: `/pages/${page.id}` });
  const words = schema.text(page.title, link === undefined ? [] : [link]);
  view.dispatch(view.state.tr.replaceWith(typed.from, typed.to, words).insertText(' '));
  view.focus();
}

function embed(ctx: Ctx, view: EditorView, typed: Typed, page: PageIndexEntry): void {
  const raw = `![[${page.jdId ?? page.title}]]`;
  const node = wikiTextNode.type(ctx).create({ raw });
  view.dispatch(view.state.tr.replaceWith(typed.from, typed.to, node));
  view.focus();
}

function choicesFor(ctx: Ctx, view: EditorView, typed: Typed, deps: PickerDeps): MenuItem[] {
  return deps
    .pages()(typed.query, SHOWN)
    .flatMap((page) => [
      {
        title: page.title,
        meta: page.jdId ?? page.jdArea,
        choose: () => {
          linkTo(view, typed, page);
        },
      },
      {
        title: `Embed ${page.title}`,
        meta: 'Show it in place',
        choose: () => {
          embed(ctx, view, typed, page);
        },
      },
    ])
    .slice(0, SHOWN);
}

function keyed(menu: Menu, event: KeyboardEvent): boolean {
  if (!menu.isOpen()) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    menu.move(event.key === 'ArrowDown' ? 1 : -1);
    return true;
  }
  if (event.key === 'Enter') return menu.choose();
  if (event.key === 'Escape') {
    menu.hide();
    return true;
  }
  return false;
}

export function pagePicker(deps: PickerDeps) {
  return $prose(
    (ctx) =>
      new Plugin({
        key: new PluginKey('pagePicker'),
        view: () => ({
          update: (view) => {
            const typed = typedAt(view);
            if (typed === null) {
              deps.menu.hide();
              return;
            }
            deps.menu.show(choicesFor(ctx, view, typed, deps), placeOf(view, typed.from));
          },
          destroy: () => deps.menu.hide(),
        }),
        props: { handleKeyDown: (_view, event) => keyed(deps.menu, event) },
      }),
  );
}
