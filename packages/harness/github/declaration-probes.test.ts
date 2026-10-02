import { describe, expect, it } from 'vitest';
import { parseDeclaration, parseReviewProvider, type DeclarationProblem } from './declaration.ts';

type Probe = readonly [string, string, DeclarationProblem];

function keyLines(tier: string): readonly string[] {
  return [
    'closes: #12',
    'risks: the board renders slower on phones',
    'touches: apps/uw-app/board',
    `risk_tier: ${tier}`,
    'risk_domains: none',
  ];
}

function block(opening: string, tier: string, closing = '```'): string {
  return [opening, ...keyLines(tier), closing].join('\n');
}

const low = block('```harness', 'low');
const high = block('```harness', 'high');

function quoted(text: string, marker: string): string {
  return text
    .split('\n')
    .map((line) => `${marker}${line}`)
    .join('\n');
}

const lookalikeOpenings: readonly (readonly [string, string])[] = [
  ['a space before the info string', '``` harness'],
  ['an indented fence', '  ```harness'],
  ['a zero-width suffix', '```harness\u200B'],
  ['a Cyrillic \u0430', '```h\u0430rness'],
  ['a tilde fence', '~~~harness'],
  ['four backticks', '````harness'],
  ['a capitalised info string', '```Harness'],
];

const lookalikeProbes: readonly Probe[] = lookalikeOpenings.flatMap(([name, opening]): Probe[] => [
  [`${name} before the exact block`, `${block(opening, 'high')}\n\n${low}`, 'missing'],
  [`${name} after the exact block`, `${low}\n\n${block(opening, 'high')}`, 'ambiguous_block'],
  [`${name} on its own`, block(opening, 'low'), 'missing'],
]);

const hidingProbes: readonly Probe[] = [
  ['a comment-hidden block beside a visible one', `${high}\n<!--\n${low}\n-->`, 'ambiguous_block'],
  ['a comment-hidden block alone', `<!--\n${low}\n-->`, 'ambiguous_block'],
  ['a processing instruction hiding the block', `<?\n${low}\n?>\n${high}`, 'ambiguous_block'],
  ['a processing instruction after the block', `${low}\n<?x\n${high}\n?>`, 'ambiguous_block'],
  ['a CDATA section after the block', `${low}\n<![CDATA[\n${high}\n]]>`, 'ambiguous_block'],
  ['a declaration-like tag after the block', `${low}\n<!X\n${high}\n>`, 'ambiguous_block'],
  ['a template comment after the block', `${low}\n<!-- a template note -->`, 'ambiguous_block'],
  ['details hiding the block', `<details>\n\n${low}\n\n</details>\n\n> risk_tier: high`, 'missing'],
  ['details after the block', `${low}\n\n<details>\n\n${high}\n\n</details>`, 'ambiguous_block'],
  ['an example fence holding the block', ['````markdown', low, '````'].join('\n'), 'missing'],
  [
    'an example fence after the block',
    `${low}\n\n${['````md', high, '````'].join('\n')}`,
    'ambiguous_block',
  ],
];

const rereviewProbes: readonly Probe[] = [
  ['a block hidden by a processing instruction alone', `<?\n${low}\n?>`, 'ambiguous_block'],
  ['a block hidden by CDATA alone', `<![CDATA[\n${low}\n]]>`, 'ambiguous_block'],
  ['a block hidden by <!X alone', `<!X\n${low}\n>`, 'ambiguous_block'],
  [
    'a hidden block under a quoted visible one',
    `${quoted(high, '> ')}\n<?\n${low}\n?>`,
    'ambiguous_block',
  ],
  [
    'a hidden block under a lone-CR visible one',
    `${high.replaceAll('\n', '\r')}\n<?\n${low}\n?>`,
    'ambiguous_block',
  ],
  [
    'a block in details beside a quoted tier',
    `<details>\n\n${low}\n\n</details>\n\n> risk_tier: high`,
    'missing',
  ],
  [
    'a head block in details beside a quoted tier',
    `${low}\n<details>\n\n> risk_tier: high\n</details>`,
    'ambiguous_block',
  ],
];

const lineBreakProbes: readonly Probe[] = [
  ['a lone-CR block after the block', `${low}\n${high.replaceAll('\n', '\r')}`, 'ambiguous_block'],
  ['a lone-CR block first', `${high.replaceAll('\n', '\r')}\n${low}`, 'ambiguous_block'],
  ['a U+2028-joined block', `${low}\n${high.replaceAll('\n', '\u2028')}`, 'ambiguous_block'],
  ['a U+2029-joined block', `${low}\n${high.replaceAll('\n', '\u2029')}`, 'ambiguous_block'],
  ['a NEL in the body', `${low}\nnote\u0085risk_tier: high`, 'ambiguous_block'],
  ['a form feed in the body', `${low}\nnote\f`, 'ambiguous_block'],
  ['a vertical tab in the body', `${low}\nnote\v`, 'ambiguous_block'],
  ['a BOM before the block', `\uFEFF${low}`, 'ambiguous_block'],
  ['a BOM after the block', `${low}\n\uFEFF`, 'ambiguous_block'],
];

const containerProbes: readonly Probe[] = [
  ['a blockquoted fence after the block', `${low}\n\n${quoted(high, '> ')}`, 'ambiguous_block'],
  ['a nested blockquoted fence', `${low}\n\n${quoted(high, '>> ')}`, 'ambiguous_block'],
  ['a list-item fence', `${low}\n\n${quoted(high, '- ')}`, 'ambiguous_block'],
  ['an ordered-list fence', `${low}\n\n${quoted(high, '1. ')}`, 'ambiguous_block'],
  ['a quoted key line', `${low}\n\n> risk_tier: high`, 'ambiguous_block'],
  [
    'a table row naming the tier',
    `${low}\n\n| key | value |\n| --- | --- |\n| risk_tier | high |`,
    'ambiguous_block',
  ],
  ['a heading naming the tier', `${low}\n\n## risk tier: **HIGH**`, 'ambiguous_block'],
  ['a key line in another case', `${low}\nRisk_Tier: high`, 'ambiguous_block'],
  ['a key line with a zero-width character', `${low}\nrisk\u200B_tier: high`, 'ambiguous_block'],
  ['a spaced key line', `${low}\n  risks : none`, 'ambiguous_block'],
  ['a second exact block', `${low}\n\n${high}`, 'ambiguous_block'],
];

const insideProbes: readonly Probe[] = [
  ['a tilde fence inside the block', block('```harness', 'low', '~~~\n```'), 'ambiguous_block'],
  ['an indented closing fence', block('```harness', 'low', '  ```'), 'ambiguous_block'],
  ['four backticks inside the block', block('```harness', 'low', '````\n```'), 'ambiguous_block'],
  ['key lines with no fence', `${keyLines('low').join('\n')}`, 'missing'],
  [
    'an unclosed block borrowing a later close',
    ['```harness', ...keyLines('low'), '', '```ts', 'x', '```'].join('\n'),
    'ambiguous_block',
  ],
  ['an unclosed block', ['```harness', ...keyLines('low')].join('\n'), 'unclosed_block'],
];

describe('P16 a PR body cannot show one declaration and have another read', () => {
  it.each(lookalikeProbes)('refuses %s', (_name, body, problem) => {
    expect(parseDeclaration(body)).toEqual({ ok: false, problem });
  });

  it.each(hidingProbes)('refuses %s', (_name, body, problem) => {
    expect(parseDeclaration(body)).toEqual({ ok: false, problem });
  });

  it.each(rereviewProbes)('refuses %s', (_name, body, problem) => {
    expect(parseDeclaration(body)).toEqual({ ok: false, problem });
  });

  it.each(lineBreakProbes)('refuses %s', (_name, body, problem) => {
    expect(parseDeclaration(body)).toEqual({ ok: false, problem });
  });

  it.each(containerProbes)('refuses %s', (_name, body, problem) => {
    expect(parseDeclaration(body)).toEqual({ ok: false, problem });
  });

  it.each(insideProbes)('refuses %s', (_name, body, problem) => {
    expect(parseDeclaration(body)).toEqual({ ok: false, problem });
  });

  it('still reads a head block followed by ordinary code blocks and prose', () => {
    const body = [
      low,
      '',
      'Closes the board work.',
      '```ts',
      'const tier = 1;',
      '```',
      '~~~',
      'plain',
      '~~~',
    ];
    expect(parseDeclaration(body.join('\n'))).toMatchObject({
      ok: true,
      declaration: { riskTier: 'low' },
    });
    expect(parseDeclaration(body.join('\r\n'))).toMatchObject({
      ok: true,
      declaration: { riskTier: 'low' },
    });
  });
});

function reviewBlock(provider: string): string {
  return ['```harness-review', `provider: ${provider}`, 'model: claude', '```'].join('\n');
}

describe('the review provider cannot be shown as one and read as another', () => {
  it('reads a head harness-review block', () => {
    expect(parseReviewProvider(`${reviewBlock('anthropic')}\nLooks good.`)).toBe('anthropic');
  });

  it.each([
    [
      'a quoted visible block over a hidden one',
      `${quoted(reviewBlock('anthropic'), '> ')}\n<?\n${reviewBlock('openai')}\n?>`,
    ],
    [
      'a hidden block after the head',
      `${reviewBlock('openai')}\n<?\n${reviewBlock('anthropic')}\n?>`,
    ],
    [
      'a quoted second block after the head',
      `${reviewBlock('openai')}\n\n${quoted(reviewBlock('anthropic'), '> ')}`,
    ],
    ['a provider line after the head', `${reviewBlock('openai')}\n\nprovider: anthropic`],
    ['a lone-CR body', reviewBlock('openai').replaceAll('\n', '\r')],
    ['a body not opening with the block', `Looks good.\n${reviewBlock('openai')}`],
  ])('is nothing for %s', (_name, body) => {
    expect(parseReviewProvider(body)).toBeNull();
  });
});

const rawBlockProbes: readonly Probe[] = [
  [
    'a one-line raw pre harness block',
    `${low}\n<pre lang="harness">closes: none&#10;risks: r&#10;touches: t&#10;risk_tier: high&#10;risk_domains: none</pre>`,
    'ambiguous_block',
  ],
  [
    'a multi-line raw pre block with entity-spelled keys',
    `${low}\n<pre lang="harness">\ncloses&#58; none\nrisk&#95;tier&#58; high\n</pre>`,
    'ambiguous_block',
  ],
  [
    'an uppercase PRE block',
    `${low}\n<PRE LANG="harness">risk_tier: high</PRE>`,
    'ambiguous_block',
  ],
  ['a raw code element', `${low}\n<code>risk_tier: high</code>`, 'ambiguous_block'],
  [
    'a decimal-entity fence label',
    `${low}\n\n${block('```h&#97;rness', 'high')}`,
    'ambiguous_block',
  ],
  [
    'a hex-entity tilde label',
    `${low}\n\n${block('~~~h&#x61;rness', 'high', '~~~')}`,
    'ambiguous_block',
  ],
  ['a named entity in a key line', `${low}\n\nrisk&lowbar;tier&colon; high`, 'ambiguous_block'],
  [
    'a named entity in a fence label',
    `${low}\n\n${block('```harn&eacute;ss', 'high')}`,
    'ambiguous_block',
  ],
  [
    'an entity-spelled label with homoglyph keys',
    `${low}\n\n${['```h&#97;rness', 'r\u0456sk_tier: high', '```'].join('\n')}`,
    'ambiguous_block',
  ],
  [
    'a punctuated label with homoglyph keys',
    `${low}\n\n${['```h.rness', 'r\u0456sk_tier: high', '```'].join('\n')}`,
    'ambiguous_block',
  ],
  [
    'a non-ASCII label with homoglyph keys',
    `${low}\n\n${['```harn\u0435ss', 'r\u0456sk_tier: high', '```'].join('\n')}`,
    'ambiguous_block',
  ],
  ['a backslash-escaped label', `${low}\n\n${block('```harnes\\s', 'high')}`, 'ambiguous_block'],
  [
    'a NUL in the block',
    block('```harness', 'low').replace('risks: ', 'risks: a\u0000'),
    'ambiguous_block',
  ],
  ['a backslash-escaped key line', `${low}\n\nrisk\\_tier: high`, 'ambiguous_block'],
  ['a tagged key line', `${low}\n\n<b>risk_tier</b>: high`, 'ambiguous_block'],
];

describe('P16 a raw or entity-spelled harness block after the head is refused', () => {
  it.each(rawBlockProbes)('refuses %s', (_name, body, problem) => {
    expect(parseDeclaration(body)).toEqual({ ok: false, problem });
  });

  it('still reads a head block beside an ampersand in prose and a plain-labelled fence', () => {
    const body = [low, '', 'R&D work, Q&A notes.', '```yaml', 'a: 1', '```'].join('\n');
    expect(parseDeclaration(body)).toMatchObject({ ok: true, declaration: { riskTier: 'low' } });
  });
});

describe('the review provider cannot be shown twice through raw HTML or an entity label', () => {
  it.each([
    [
      'a raw pre harness-review block',
      `${reviewBlock('anthropic')}\n<pre lang="harness-review">provider: openai</pre>`,
    ],
    [
      'an entity-spelled harness-review label',
      `${reviewBlock('anthropic')}\n\n${['```h&#97;rness-review', 'pr\u043Evider: openai', '```'].join('\n')}`,
    ],
  ])('is nothing for %s', (_name, body) => {
    expect(parseReviewProvider(body)).toBeNull();
  });
});
