import type { PullRequestDeclaration } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import {
  parseDeclaration,
  parseReviewProvider,
  riskDeclarationOf,
  type DeclarationParse,
  type DeclarationProblem,
} from './declaration.ts';

const fields: readonly string[] = [
  'closes: #12, unfoldingWord/uw-platform#14',
  'risks: the board renders slower on phones',
  'touches: apps/uw-app/board',
  'risk_tier: standard',
  'risk_domains: none',
];

const parsed: PullRequestDeclaration = {
  closes: ['#12', 'unfoldingWord/uw-platform#14'],
  risks: 'the board renders slower on phones',
  touches: 'apps/uw-app/board',
  riskTier: 'standard',
  riskDomains: [],
};

function bodyWith(lines: readonly string[]): string {
  return ['Adds the board.', '', '```harness', ...lines, '```'].join('\n');
}

function replaced(key: string, line: string | null): readonly string[] {
  return fields.flatMap((field) => {
    if (!field.startsWith(`${key}: `)) return [field];
    return line === null ? [] : [line];
  });
}

function failure(problem: DeclarationProblem): DeclarationParse {
  return { ok: false, problem };
}

function success(declaration: PullRequestDeclaration): DeclarationParse {
  return { ok: true, declaration };
}

const body = bodyWith(fields);

describe('P16 the PR declaration is parsed from the fenced harness block', () => {
  it('parses the block into the declaration', () => {
    expect(parseDeclaration(body)).toEqual(success(parsed));
  });

  it('parses the same block with CRLF line endings', () => {
    expect(parseDeclaration(body.replaceAll('\n', '\r\n'))).toEqual(success(parsed));
  });

  it('puts risk domains in schema order whatever the written order', () => {
    const lines = replaced('risk_domains', 'risk_domains: migration, acl');
    expect(parseDeclaration(bodyWith(lines))).toEqual(
      success({ ...parsed, riskDomains: ['acl', 'migration'] }),
    );
  });

  it('refuses a risk domain written twice', () => {
    const lines = replaced('risk_domains', 'risk_domains: acl, acl');
    expect(parseDeclaration(bodyWith(lines))).toEqual(failure('invalid_value'));
  });

  it('reads closes: none as no issues and refuses a bare number', () => {
    const none = replaced('closes', 'closes: none');
    expect(parseDeclaration(bodyWith(none))).toEqual(success({ ...parsed, closes: [] }));
    const twice = replaced('closes', 'closes: #12, #12, a/b#3');
    expect(parseDeclaration(bodyWith(twice))).toEqual(
      success({ ...parsed, closes: ['#12', 'a/b#3'] }),
    );
    const bare = replaced('closes', 'closes: 12');
    expect(parseDeclaration(bodyWith(bare))).toEqual(failure('invalid_value'));
  });
});

describe('P16 a PR body without exactly one closed harness block declares nothing', () => {
  it('finds no declaration in an absent, empty or unfenced body', () => {
    expect(parseDeclaration(null)).toEqual(failure('missing'));
    expect(parseDeclaration('')).toEqual(failure('missing'));
    expect(parseDeclaration(fields.join('\n'))).toEqual(failure('missing'));
  });

  it('takes a harnessx fence for an ambiguous block, not a declaration', () => {
    expect(parseDeclaration(body.replace('```harness', '```harnessx'))).toEqual(
      failure('ambiguous_block'),
    );
  });

  it('refuses two harness blocks', () => {
    expect(parseDeclaration(`${body}\n\n${body}`)).toEqual(failure('ambiguous_block'));
  });

  it('refuses a block with no closing fence', () => {
    const unclosed = ['```harness', ...fields].join('\n');
    expect(parseDeclaration(unclosed)).toEqual(failure('unclosed_block'));
  });

  it('refuses a body longer than a GitHub PR body may be', () => {
    expect(parseDeclaration(`${body}\n${'x'.repeat(65_536)}`)).toEqual(failure('too_long'));
  });

  it('counts a body that is not a string as missing', () => {
    expect(parseDeclaration(JSON.parse('{}').body)).toEqual(failure('missing'));
  });
});

describe('P16 a harness block with a wrong line declares nothing', () => {
  it('refuses an unknown key', () => {
    expect(parseDeclaration(bodyWith([...fields, 'owner: me']))).toEqual(failure('unknown_key'));
  });

  it('refuses a key written twice', () => {
    const twice = [...fields, 'risk_tier: high'];
    expect(parseDeclaration(bodyWith(twice))).toEqual(failure('duplicate_key'));
  });

  it('refuses a block missing a key', () => {
    expect(parseDeclaration(bodyWith(replaced('touches', null)))).toEqual(failure('missing_key'));
  });

  it('refuses a risk tier outside the closed set', () => {
    const lines = replaced('risk_tier', 'risk_tier: medium');
    expect(parseDeclaration(bodyWith(lines))).toEqual(failure('invalid_value'));
  });

  it('refuses a line that is not key: value', () => {
    expect(parseDeclaration(bodyWith([...fields, 'risk_tier standard']))).toEqual(
      failure('invalid_value'),
    );
    const noSpace = replaced('risk_tier', 'risk_tier:standard');
    expect(parseDeclaration(bodyWith(noSpace))).toEqual(failure('invalid_value'));
  });

  it('refuses an empty value', () => {
    expect(parseDeclaration(bodyWith(replaced('risks', 'risks: ')))).toEqual(
      failure('invalid_value'),
    );
  });
});

describe('the risk declaration is the parsed tier and domains or nothing', () => {
  it('takes the tier and domains from a declaration', () => {
    expect(riskDeclarationOf({ ...parsed, riskTier: 'high', riskDomains: ['acl'] })).toEqual({
      riskTier: 'high',
      riskDomains: ['acl'],
    });
  });

  it('is nothing without a declaration', () => {
    expect(riskDeclarationOf(null)).toBeNull();
  });
});

function reviewBody(provider: string): string {
  return ['Looks good.', '```harness-review', provider, 'model: claude', '```'].join('\n');
}

describe('the review provider comes from the fenced harness-review block', () => {
  it('reads and normalises the provider', () => {
    expect(parseReviewProvider(reviewBody('provider: Anthropic'))).toBe('anthropic');
  });

  it('counts a provider outside [a-z0-9._-] as nothing', () => {
    expect(parseReviewProvider(reviewBody('provider: Google Vertex'))).toBeNull();
  });

  it('is nothing without exactly one well-formed block', () => {
    expect(parseReviewProvider(null)).toBeNull();
    expect(parseReviewProvider('Looks good.')).toBeNull();
    const twice = reviewBody('provider: anthropic');
    expect(parseReviewProvider(`${twice}\n${twice}`)).toBeNull();
    expect(parseReviewProvider(reviewBody('model: claude'))).toBeNull();
    const repeated = reviewBody('provider: anthropic\nprovider: openai');
    expect(parseReviewProvider(repeated)).toBeNull();
  });
});

const visibleHigh = bodyWith(replaced('risk_tier', 'risk_tier: high'));
const hiddenLow = `<!--\n${bodyWith(replaced('risk_tier', 'risk_tier: low'))}\n-->`;

function lookalike(opening: string): string {
  const lines = replaced('risk_tier', 'risk_tier: low');
  return [opening, ...lines, '```'].join('\n');
}

const lookalikeOpenings: readonly (readonly [string, string])[] = [
  ['a space before the info string', '``` harness'],
  ['an indented fence', '  ```harness'],
  ['a zero-width suffix', '```harness\u200B'],
  ['a Cyrillic а', '```h\u0430rness'],
  ['a tilde fence', '~~~harness'],
  ['four backticks', '````harness'],
  ['a capitalised info string', '```Harness'],
];

describe('P16 a PR body cannot show one declaration and have another read', () => {
  it('refuses any body holding an HTML comment', () => {
    expect(parseDeclaration(`${visibleHigh}\n${hiddenLow}`)).toEqual(failure('ambiguous_block'));
    expect(parseDeclaration(hiddenLow)).toEqual(failure('ambiguous_block'));
    expect(parseDeclaration(`${body}\n<!-- a template note -->`)).toEqual(
      failure('ambiguous_block'),
    );
  });

  it.each(lookalikeOpenings)('refuses %s beside the exact block', (_name, opening) => {
    expect(parseDeclaration(`${lookalike(opening)}\n\n${visibleHigh}`)).toEqual(
      failure('ambiguous_block'),
    );
    expect(parseDeclaration(`${visibleHigh}\n\n${lookalike(opening)}`)).toEqual(
      failure('ambiguous_block'),
    );
  });

  it.each(lookalikeOpenings)('refuses %s on its own', (_name, opening) => {
    expect(parseDeclaration(lookalike(opening))).toEqual(failure('ambiguous_block'));
  });

  it('refuses an exact block shown as an example inside another fence', () => {
    const example = ['````markdown', ...visibleHigh.split('\n'), '````'].join('\n');
    expect(parseDeclaration(example)).toEqual(failure('ambiguous_block'));
  });

  it('refuses a declaration key line outside the block, whatever its case', () => {
    expect(parseDeclaration(`Risk_Tier: low\n${body}`)).toEqual(failure('ambiguous_block'));
    expect(parseDeclaration(`${body}\n  risks : none`)).toEqual(failure('ambiguous_block'));
    expect(parseDeclaration(`${body}\nrisk\u200B_tier: low`)).toEqual(failure('ambiguous_block'));
  });

  it('still reads a block beside ordinary code blocks and prose', () => {
    const withCode = ['```ts', 'const tier = 1;', '```', body, '~~~', 'plain', '~~~'].join('\n');
    expect(parseDeclaration(withCode)).toEqual(success(parsed));
  });
});
