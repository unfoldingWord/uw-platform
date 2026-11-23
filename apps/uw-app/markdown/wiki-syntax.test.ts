import { describe, expect, it } from 'vitest';
import { pageRefs, rewriteWikiRefs, wikiRefs } from './wiki-syntax.ts';

const ID = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
const OTHER = '00000000-0000-4000-8000-000000000002';

describe('#175 wiki links and embeds are found where a person typed them', () => {
  it('reads a link, a link with its own words, an embed and an embed of one section', () => {
    const found = wikiRefs(
      'See [[Security Guidelines]] and [[01.47|the rules]].\n\n![[Budgeting]]\n\n![[Budgeting#Program costs]]',
    );
    expect(found.map(({ kind, target, heading, label }) => [kind, target, heading, label])).toEqual(
      [
        ['link', 'Security Guidelines', null, null],
        ['link', '01.47', null, 'the rules'],
        ['embed', 'Budgeting', null, null],
        ['embed', 'Budgeting', 'Program costs', null],
      ],
    );
  });

  it('leaves code alone, inline and fenced, and an escaped bracket', () => {
    expect(wikiRefs('Type `[[like this]]` to link.')).toEqual([]);
    expect(wikiRefs('```\n[[not a link]]\n```')).toEqual([]);
    expect(wikiRefs('\\[[not a link]]')).toEqual([]);
    expect(wikiRefs('[[  ]] and [[]]')).toEqual([]);
  });
});

describe('#175 a resolved wiki link is rewritten in place and nothing else changes', () => {
  const resolve = (target: string) =>
    target === 'missing' ? null : { id: ID, title: '01.47 Security Guidelines' };

  it('writes a standard link to the page id, with the title or the words the author gave', () => {
    const body = 'Read [[01.47]] first, then [[01.47|the rules]] again.';
    expect(rewriteWikiRefs(body, resolve)).toBe(
      `Read [01.47 Security Guidelines](/pages/${ID}) first, then [the rules](/pages/${ID}) again.`,
    );
  });

  it('writes an embed as an image of the page address, with the section as its fragment', () => {
    expect(rewriteWikiRefs('![[01.47#Use Strong Passwords]]', resolve)).toBe(
      `![01.47 Security Guidelines](/pages/${ID}#use-strong-passwords)`,
    );
    expect(rewriteWikiRefs('![[01.47]]', resolve)).toBe(
      `![01.47 Security Guidelines](/pages/${ID})`,
    );
  });

  it('leaves a link it cannot resolve exactly as typed, and escapes a title with brackets', () => {
    expect(rewriteWikiRefs('[[missing]] and `[[01.47]]`', resolve)).toBe(
      '[[missing]] and `[[01.47]]`',
    );
    const odd = () => ({ id: ID, title: 'Plans [draft]' });
    expect(rewriteWikiRefs('[[x]]', odd)).toBe(`[Plans \\[draft\\]](/pages/${ID})`);
  });
});

describe('#175 the pages a body points at are read from its links and embeds', () => {
  it('lists linked and embedded page ids once each, and ignores other addresses and code', () => {
    const body = [
      `[a](/pages/${ID}) and again [b](/pages/${ID})`,
      `![c](/pages/${OTHER}#rules)`,
      '[site](https://example.org/pages/x) ![pic](/api/files/1)',
      `\`[code](/pages/${OTHER})\``,
    ].join('\n\n');
    expect(pageRefs(body)).toEqual({
      links: [ID],
      embeds: [{ id: OTHER, fragment: 'rules' }],
    });
  });
});
