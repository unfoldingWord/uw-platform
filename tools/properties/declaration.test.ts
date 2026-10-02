import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  pullRequestDeclarationSchema,
  riskDomainSchema,
  riskTierSchema,
  type PullRequestDeclaration,
} from '../../packages/contracts/index.ts';
import { parseDeclaration } from '../../packages/harness/github/declaration.ts';

const problems: ReadonlySet<string> = new Set([
  'missing',
  'too_long',
  'ambiguous_block',
  'unclosed_block',
  'unknown_key',
  'duplicate_key',
  'missing_key',
  'invalid_value',
]);

const text = fc
  .string({ unit: fc.constantFrom(...'abcxyz ./-_'), minLength: 1, maxLength: 60 })
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const declarations: fc.Arbitrary<PullRequestDeclaration> = fc.record({
  closes: fc.uniqueArray(fc.constantFrom('#1', '#12', 'unfoldingWord/uw-platform#14', 'a/b#9'), {
    maxLength: 4,
  }),
  risks: text,
  touches: text,
  riskTier: fc.constantFrom(...riskTierSchema.options),
  riskDomains: fc.shuffledSubarray([...riskDomainSchema.options]),
});

function listLine(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join(', ');
}

function rendered(declaration: PullRequestDeclaration): string {
  return [
    'Some prose.',
    '```harness',
    `closes: ${listLine(declaration.closes)}`,
    `risks: ${declaration.risks}`,
    `touches: ${declaration.touches}`,
    `risk_tier: ${declaration.riskTier}`,
    `risk_domains: ${listLine(declaration.riskDomains)}`,
    '```',
  ].join('\n');
}

const linePool = fc.constantFrom(
  '```harness',
  '```harnessx',
  '```',
  ' ```harness',
  'closes: #12',
  'closes: none',
  'risks: slower',
  'touches: apps',
  'risk_tier: high',
  'risk_tier: medium',
  'risk_domains: acl, migration',
  'risk_domains: acl, acl',
  'owner: me',
  'risk_tier standard',
  'Risk_Tier: low',
  '  touches : apps',
  '<!--',
  '-->',
  '``` harness',
  '  ```harness',
  '```harness\u200B',
  '```h\u0430rness',
  '~~~harness',
  '````harness',
  '```Harness',
  '````',
  '~~~',
  '```ts',
  'prose about the change',
  '',
  '\r',
);

const surrounded = fc
  .tuple(fc.array(linePool, { maxLength: 6 }), declarations, fc.array(linePool, { maxLength: 6 }))
  .map(([before, declaration, after]) => [...before, rendered(declaration), ...after].join('\n'));

const lookalikeOpenings = fc.constantFrom(
  '``` harness',
  '  ```harness',
  '```harness\u200B',
  '```h\u0430rness',
  '~~~harness',
  '````harness',
  '```Harness',
  '\u200B```harness',
);

const relabelled = fc
  .tuple(lookalikeOpenings, declarations)
  .map(([opening, declaration]) => rendered(declaration).replace('```harness', opening));

const bodies = fc.oneof(
  surrounded,
  relabelled,
  fc.string({ unit: 'grapheme', maxLength: 400 }),
  fc
    .array(fc.oneof(linePool, fc.string({ maxLength: 30 })), { maxLength: 30 })
    .map((lines) => lines.join('\n')),
  fc.array(linePool, { maxLength: 30 }).map((lines) => lines.join('\r\n')),
);

const keyLine = /^(?:closes|risks|touches|risk_tier|risk_domains)\s*:/u;
const fenceRun = /^(?:`{3,}|~{3,})/u;

function detected(line: string): string {
  return line
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .trimStart();
}

function isCandidate(line: string): boolean {
  const run = fenceRun.exec(line)?.[0];
  if (run === undefined) return false;
  const info = line.slice(run.length);
  return info.toLowerCase().includes('harness') || /[^\x20-\x7e]/u.test(info);
}

function assertUnambiguous(body: string): void {
  expect(body.includes('<!--')).toBe(false);
  const raw = body.split(/\r?\n/u).map((line) => line.trimEnd());
  const seen = raw.map(detected);
  const candidates = seen.flatMap((line, index) => (isCandidate(line) ? [index] : []));
  expect(candidates).toHaveLength(1);
  const start = candidates[0] ?? -1;
  expect(raw[start]).toBe('```harness');
  const end = raw.indexOf('```', start + 1);
  const outside = seen.filter((_line, index) => index < start || index > end);
  expect(outside.filter((line) => keyLine.test(line.toLowerCase()))).toEqual([]);
}

function assertWellFormed(body: string): void {
  const result = parseDeclaration(body);
  if (!result.ok) {
    expect(problems.has(result.problem)).toBe(true);
    return;
  }
  expect(pullRequestDeclarationSchema.parse(result.declaration)).toEqual(result.declaration);
  assertUnambiguous(body);
}

function assertReadsBack(declaration: PullRequestDeclaration): void {
  const riskDomains = riskDomainSchema.options.filter((domain) =>
    declaration.riskDomains.includes(domain),
  );
  expect(parseDeclaration(rendered(declaration))).toEqual({
    ok: true,
    declaration: { ...declaration, riskDomains },
  });
}

function assertTooLong(length: number): void {
  const body = 'a: '.repeat(length).slice(0, length);
  expect(parseDeclaration(body)).toEqual({ ok: false, problem: 'too_long' });
}

describe('P16 any PR body parses to one unambiguous declaration or one closed-set problem', () => {
  it('never throws, and declares only from one exact block with no lookalike and no stray key line', () => {
    fc.assert(fc.property(bodies, assertWellFormed), { numRuns: 1000 });
  });

  it('reads back every declaration it is written from, domains in schema order', () => {
    fc.assert(fc.property(declarations, assertReadsBack), { numRuns: 500 });
  });

  it('refuses every body longer than the bound', () => {
    fc.assert(fc.property(fc.integer({ min: 65_537, max: 200_000 }), assertTooLong), {
      numRuns: 20,
    });
  });
});
