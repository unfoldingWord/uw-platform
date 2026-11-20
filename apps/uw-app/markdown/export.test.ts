import { describe, expect, it } from 'vitest';
import type { Page } from '@uw/contracts';
import { exportMarkdown } from './export.ts';
import type { EmbedSource } from './page-refs.ts';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function page(bodyMd: string): Page {
  return {
    id: B,
    type: 'knowledge',
    jdArea: '00-09',
    slug: 'security',
    title: 'Security "rules"',
    parentId: null,
    frontmatter: { jd_category: '01', jd_id: '01.47', tags: ['policy'], verified_until: null },
    bodyMd,
    version: 3,
    status: 'active',
  };
}

const source: EmbedSource = {
  kind: 'page',
  title: 'Passwords',
  bodyMd:
    'Intro.\n\n## Rules\n\nUse strong ones.\n\n### Length\n\nTwelve.\n\n## Travel\n\nAsk first.',
};

const sources = (id: string): EmbedSource => (id === A ? source : { kind: 'missing' });

describe('#175 a page is exported as markdown that stands on its own', () => {
  it('leads with the title and filing as front matter', () => {
    const text = exportMarkdown(page('Body.'), sources);
    expect(text).toBe(
      [
        '---',
        'title: "Security \\"rules\\""',
        'jd_id: "01.47"',
        'category: "01"',
        'area: "00-09"',
        'version: 3',
        'tags: ["policy"]',
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
    );
  });

  it('writes an embedded section out in full, up to the next heading of its level', () => {
    const text = exportMarkdown(
      page(`Before.\n\n![Passwords](/pages/${A}#rules)\n\nAfter.`),
      sources,
    );
    expect(text).toContain(
      '**From Passwords:**\n\n## Rules\n\nUse strong ones.\n\n### Length\n\nTwelve.',
    );
    expect(text).not.toContain('Ask first.');
    expect(text).toContain('Before.');
    expect(text).toContain('After.');
  });

  it('writes a whole embedded page, and says so when a source or section is gone', () => {
    expect(exportMarkdown(page(`![P](/pages/${A})`), sources)).toContain('Ask first.');
    expect(exportMarkdown(page(`![P](/pages/${A}#nowhere)`), sources)).toContain(
      '> This section no longer exists.',
    );
    expect(exportMarkdown(page(`![P](/pages/${B})`), sources)).toContain(
      '> This section no longer exists.',
    );
  });

  it('leaves an embed inside a code block as written', () => {
    const body = `\`\`\`\n![P](/pages/${A})\n\`\`\``;
    expect(exportMarkdown(page(body), sources)).toContain(body);
  });
});
