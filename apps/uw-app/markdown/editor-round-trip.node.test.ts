import { beforeAll, describe, expect, it } from 'vitest';
import { installDom } from '../islands/editor/test-dom.ts';
import { sameMeaning } from '../islands/editor/same-meaning.ts';
import { roundTripSamples } from './round-trip-samples.ts';
import { wikiRefs } from './wiki-syntax.ts';

function liveWikiLinks(markdown: string): readonly string[] {
  return wikiRefs(markdown).map((ref) => `${ref.kind}:${ref.target}`);
}

type Through = (markdown: string) => Promise<string>;

let throughEditor: Through = () => Promise.resolve('');

beforeAll(async () => {
  installDom('<!DOCTYPE html><body></body>');
  const { pageEditor } = await import('../islands/editor/crepe-editor.ts');
  throughEditor = async (markdown) => {
    const root = document.createElement('div');
    document.body.append(root);
    const editor = pageEditor({
      root,
      markdown,
      upload: () => Promise.resolve(''),
      slashItems: [],
      plugins: [],
    });
    await editor.create();
    const out = editor.getMarkdown();
    await editor.destroy();
    root.remove();
    return out;
  };
});

const reflowed = (markdown: string) => /!\[[^\]]*\]\(|^\|/m.test(markdown);
const samples = roundTripSamples.map((sample) => [sample.name, sample.markdown] as const);

describe('#175 the editor keeps the markdown it was given', () => {
  it.each(samples)('keeps the meaning of %s', async (_name, markdown) => {
    expect(sameMeaning(markdown, await throughEditor(markdown))).toBe(true);
  });

  it.each(samples.filter(([, markdown]) => !reflowed(markdown)))(
    'writes %s back as it was written',
    async (_name, markdown) => {
      expect((await throughEditor(markdown)).trim()).toBe(markdown);
    },
  );
});

describe('#175 the meaning check counts live wiki links', () => {
  it('tells an escaped wiki link from a live one', () => {
    expect(sameMeaning('See \\[[X]].', 'See [[X]].')).toBe(false);
    expect(sameMeaning('See \\![[X]].', 'See ![[X]].')).toBe(false);
    expect(sameMeaning('See [[X]].', 'See [[X]].')).toBe(true);
  });
});

describe('#175 a reference link means the same as the inline link the editor writes', () => {
  it('opens a page with reference links in the editor', async () => {
    const markdown = 'See [the rules][rules].\n\n[rules]: https://example.org/rules';
    expect(sameMeaning(markdown, await throughEditor(markdown))).toBe(true);
  });

  it('still tells a changed link from the original', () => {
    expect(
      sameMeaning('[a][r]\n\n[r]: https://example.org/one', '[a](https://example.org/two)'),
    ).toBe(false);
  });
});

describe('#175 the editor settles, and keeps raw HTML it cannot show as written', () => {
  it('changes nothing on a second save', async () => {
    const loose = '* one\n* two\n\nSome __bold__ and _soft_ text.\n\n***\n';
    const once = await throughEditor(loose);
    expect(await throughEditor(once)).toBe(once);
    expect(sameMeaning(loose, once)).toBe(true);
  });

  it.each([
    ['a superscript', 'Area is measured in m<sup>2</sup>.'],
    ['an HTML comment', 'Visible.\n\n<!-- kept for the auditors -->'],
    ['a script', 'Before.\n\n<script>steal()</script>\n\nAfter.'],
  ])('keeps %s', async (_name, markdown) => {
    expect((await throughEditor(markdown)).trim()).toBe(markdown);
  });
});

describe('#175 wiki syntax is kept as typed', () => {
  it.each([
    ['a wiki link', 'Read [[Travel Policy]] first.'],
    ['a labelled wiki link to a section', 'See [[01.47#Limits|the limits]].'],
    ['an embed', '![[Area Descriptions]]'],
    ['a callout', '> [!WARNING]\n> Do not move any rows.'],
    ['a folded callout', '> [!NOTE]-\n> Hidden at first.'],
    ['a labelled wiki link in a table cell', '| Page | Note |\n| --- | --- |\n| [[A\\|b]] | x |'],
    ['a hard break before a wiki link', 'Related:\\\n[[A]]'],
    ['wiki links that open continuation lines', 'Related:\n[[A]]\n[[B]]\nend'],
    ['a callout whose next line opens with a wiki link', '> [!NOTE]\n> [[X]] y'],
  ])('keeps %s', async (_name, markdown) => {
    const written = (await throughEditor(markdown)).trim();
    expect(sameMeaning(markdown, written)).toBe(true);
    if (!markdown.startsWith('|')) expect(written).toBe(markdown);
  });

  it.each([
    ['before a live link', 'See \\[[X]] or [[Y]].'],
    ['at the start, before a live link', '\\[[X]] and [[Y]]'],
    ['after a character reference', 'Tom &amp; Jerry \\[[X]] and [[Y]]'],
    ['on a continuation line', 'a\n\\[[X]] c [[Y]]'],
    ['in a quote', '> a\n> \\[[X]] c [[Y]]'],
    ['in a list item', '- a\n  \\[[X]] c [[Y]]'],
    ['as an escaped embed', 'See \\![[X]] and [[Y]].'],
  ])('keeps an escaped wiki link %s escaped, and the live one live', async (_name, markdown) => {
    const written = await throughEditor(markdown);
    expect(liveWikiLinks(written)).toEqual(liveWikiLinks(markdown));
  });

  it('leaves an escaped bracket as text rather than a live link', async () => {
    const written = (await throughEditor('Write \\[[Page]] to link.')).trim();
    expect(written).not.toContain(' [[Page]]');
    expect(sameMeaning('Write \\[[Page]] to link.', written)).toBe(true);
  });

  it('aligns a table it writes, keeping every cell', async () => {
    const table = '| Item | Default |\n| --- | --- |\n| Laptop | yes |';
    expect((await throughEditor(table)).trim()).toBe(
      '| Item   | Default |\n| ------ | ------- |\n| Laptop | yes     |',
    );
  });

  it('escapes a bracket that is not wiki syntax, as any markdown editor would', async () => {
    expect((await throughEditor('A [!NOTE] mid-sentence.')).trim()).toBe(
      'A \\[!NOTE] mid-sentence.',
    );
  });
});
