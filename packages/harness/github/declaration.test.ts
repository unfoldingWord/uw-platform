import type { PullRequestDeclaration } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import {
  DECLARED_CLOSES_LIMIT,
  DECLARED_REFERENCE_LIMIT,
  declarationWithinLimit,
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
  return ['```harness', ...lines, '```', '', 'Adds the board.'].join('\n');
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

  it('does not take a harnessx fence for a harness block', () => {
    expect(parseDeclaration(body.replace('```harness', '```harnessx'))).toEqual(failure('missing'));
  });

  it('finds no declaration unless the body opens with the block', () => {
    expect(parseDeclaration(`Adds the board.\n\n${body}`)).toEqual(failure('missing'));
    expect(parseDeclaration(` ${body}`)).toEqual(failure('missing'));
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

  it('takes as many distinct closed issues as the limit and refuses one more', () => {
    const issues = (count: number): string[] =>
      [...Array.from({ length: count }).keys()].map((index) => `#${index + 1}`);
    const atLimit = replaced('closes', `closes: ${issues(DECLARED_CLOSES_LIMIT).join(', ')}`);
    expect(parseDeclaration(bodyWith(atLimit))).toEqual(
      success({ ...parsed, closes: issues(DECLARED_CLOSES_LIMIT) }),
    );
    const over = replaced('closes', `closes: ${issues(DECLARED_CLOSES_LIMIT + 1).join(', ')}`);
    expect(parseDeclaration(bodyWith(over))).toEqual(failure('invalid_value'));
    const repeated = [...issues(DECLARED_CLOSES_LIMIT), '#1'].join(', ');
    expect(parseDeclaration(bodyWith(replaced('closes', `closes: ${repeated}`)))).toEqual(
      success({ ...parsed, closes: issues(DECLARED_CLOSES_LIMIT) }),
    );
  });

  it('refuses an empty value', () => {
    expect(parseDeclaration(bodyWith(replaced('risks', 'risks: ')))).toEqual(
      failure('invalid_value'),
    );
  });
});

describe('P16 a closed issue reference in the harness block is bounded', () => {
  it('takes a closed issue reference as long as the limit and refuses one longer', () => {
    const reference = (length: number): string => `${'o'.repeat(length - 4)}/r#1`;
    const atLimit = reference(DECLARED_REFERENCE_LIMIT);
    expect(DECLARED_REFERENCE_LIMIT).toBe(160);
    expect(atLimit).toHaveLength(160);
    expect(parseDeclaration(bodyWith(replaced('closes', `closes: ${atLimit}`)))).toEqual(
      success({ ...parsed, closes: [atLimit] }),
    );
    const over = reference(DECLARED_REFERENCE_LIMIT + 1);
    expect(over).toHaveLength(161);
    expect(parseDeclaration(bodyWith(replaced('closes', `closes: #12, ${over}`)))).toEqual(
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

  it('is nothing for a stored declaration with a closed issue reference over the limit', () => {
    const atLimit = `${'o'.repeat(156)}/r#1`;
    const over = `${'o'.repeat(157)}/r#1`;
    expect(declarationWithinLimit({ ...parsed, closes: [atLimit] })).toEqual({
      ...parsed,
      closes: [atLimit],
    });
    expect(declarationWithinLimit({ ...parsed, closes: ['#12', over] })).toBeNull();
    expect(riskDeclarationOf({ ...parsed, closes: [over] })).toBeNull();
  });
});

function reviewBody(provider: string): string {
  return ['```harness-review', provider, 'model: claude', '```', 'Looks good.'].join('\n');
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
    expect(parseReviewProvider(`Looks good.\n${reviewBody('provider: anthropic')}`)).toBeNull();
    const twice = reviewBody('provider: anthropic');
    expect(parseReviewProvider(`${twice}\n${twice}`)).toBeNull();
    expect(parseReviewProvider(reviewBody('model: claude'))).toBeNull();
    const repeated = reviewBody('provider: anthropic\nprovider: openai');
    expect(parseReviewProvider(repeated)).toBeNull();
  });
});
