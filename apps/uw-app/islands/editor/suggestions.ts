import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion';
import type { PageIndexEntry } from '@uw/contracts';
import type { Matcher } from '../browser/switcher-match.ts';
import { applyFormat } from './formats.ts';
import type { Menu, MenuItem } from './menu.ts';

type Choice = { readonly title: string; readonly meta: string; readonly run: Chosen };
type Chosen = (editor: Editor, range: Range) => void;

export type SuggestionDeps = {
  readonly menu: Menu;
  readonly pages: () => Matcher;
  readonly pickFile: () => void;
};

const SHOWN = 8;

const blocks: readonly (readonly [string, string, string])[] = [
  ['Heading', 'Section title', 'heading2'],
  ['Small heading', 'Sub-section title', 'heading3'],
  ['Bulleted list', 'List', 'bullets'],
  ['Numbered list', 'Steps', 'numbers'],
  ['Checklist', 'To-do items', 'checklist'],
  ['Callout', 'A note that stands out', 'callout'],
  ['Quote', 'Quoted text', 'quote'],
  ['Collapsible section', 'Opens on a click', 'details'],
  ['Table', 'Three by three', 'table'],
  ['Code block', 'Kept exactly as typed', 'codeBlock'],
  ['Divider', 'A line across the page', 'rule'],
];

function blockChoices(query: string, deps: SuggestionDeps): readonly Choice[] {
  const wanted = query.trim().toLowerCase();
  const formats = blocks.map(([title, meta, format]) => ({
    title,
    meta,
    run: (editor: Editor, range: Range) => {
      editor.chain().focus().deleteRange(range).run();
      applyFormat(editor, format);
    },
  }));
  const file: Choice = {
    title: 'Picture or file',
    meta: 'Upload from this device',
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      deps.pickFile();
    },
  };
  return [...formats, file].filter((choice) => choice.title.toLowerCase().includes(wanted));
}

function linkTo(page: PageIndexEntry): Chosen {
  return (editor, range) => {
    const mark = { type: 'link', attrs: { href: `/pages/${page.id}` } };
    const text = { type: 'text', text: page.title, marks: [mark] };
    editor
      .chain()
      .focus()
      .insertContentAt(range, [text, { type: 'text', text: ' ' }])
      .run();
  };
}

function embedOf(page: PageIndexEntry): Chosen {
  return (editor, range) => {
    const embed = { type: 'pageEmbed', attrs: { src: `/pages/${page.id}`, title: page.title } };
    editor.chain().focus().insertContentAt(range, embed).run();
  };
}

function pageChoices(query: string, deps: SuggestionDeps): readonly Choice[] {
  return deps
    .pages()(query, SHOWN)
    .flatMap((page) => [
      { title: page.title, meta: page.jdId ?? page.jdArea, run: linkTo(page) },
      { title: `Embed ${page.title}`, meta: 'Show it in place', run: embedOf(page) },
    ])
    .slice(0, SHOWN);
}

function rendering(menu: Menu) {
  const itemsOf = (props: SuggestionProps<Choice>): MenuItem[] =>
    props.items.map((choice) => ({
      title: choice.title,
      meta: choice.meta,
      choose: () => props.command(choice),
    }));
  return () => ({
    onStart: (props: SuggestionProps<Choice>) =>
      menu.show(itemsOf(props), props.clientRect?.() ?? null),
    onUpdate: (props: SuggestionProps<Choice>) =>
      menu.show(itemsOf(props), props.clientRect?.() ?? null),
    onKeyDown: ({ event }: { readonly event: KeyboardEvent }) => {
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
    },
    onExit: () => menu.hide(),
  });
}

export function suggestionMenus(deps: SuggestionDeps): Extension {
  return Extension.create({
    name: 'pageSuggestions',
    addProseMirrorPlugins() {
      const shared = {
        editor: this.editor,
        render: rendering(deps.menu),
        command: (chosen: { editor: Editor; range: Range; props: Choice }) =>
          chosen.props.run(chosen.editor, chosen.range),
      };
      return [
        Suggestion<Choice, Choice>({
          ...shared,
          pluginKey: new PluginKey('slashMenu'),
          char: '/',
          startOfLine: false,
          items: ({ query }) => [...blockChoices(query, deps)],
        }),
        Suggestion<Choice, Choice>({
          ...shared,
          pluginKey: new PluginKey('pagePicker'),
          char: '[[',
          allowSpaces: true,
          items: ({ query }) => [...pageChoices(query, deps)],
        }),
      ];
    },
  });
}
