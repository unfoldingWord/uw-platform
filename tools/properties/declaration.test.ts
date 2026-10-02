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

function rendered(declaration: PullRequestDeclaration): readonly string[] {
  return [
    '```harness',
    `closes: ${listLine(declaration.closes)}`,
    `risks: ${declaration.risks}`,
    `touches: ${declaration.touches}`,
    `risk_tier: ${declaration.riskTier}`,
    `risk_domains: ${listLine(declaration.riskDomains)}`,
    '```',
  ];
}

const tailPool = fc.constantFrom(
  'prose about the change',
  'Closes #12',
  '```ts',
  'const tier = 1;',
  '```',
  '~~~',
  '',
  '```harness',
  '``` harness',
  '~~~harness',
  '````harness',
  '```Harness',
  '> ```harness',
  '- ```harness',
  '1. risk_tier: high',
  '> risk_tier: high',
  '| risk_tier | high |',
  '## risk tier: **HIGH**',
  'Risk_Tier: low',
  '  touches : apps',
  '<?',
  '?>',
  '<![CDATA[',
  ']]>',
  '<!--',
  '-->',
  '<!X',
  '<details>',
  '</details>',
  'a\rb',
  'a\u2028b',
  'a\u2029b',
  'a\u0085b',
  'a\fb',
  'a\vb',
  '\uFEFF',
);

const prefixPool = fc.constantFrom(
  'Adds the board.',
  '',
  '<details>',
  '<?',
  ' ',
  '> note',
  '\uFEFF',
);
const innerPool = fc.constantFrom('~~~', '````', '  ```', '```ts', '~~~harness', ' ```');
const separators = fc.constantFrom('\n', '\r\n');

const headFirst = fc
  .tuple(declarations, fc.array(tailPool, { maxLength: 6 }), separators)
  .map(([declaration, tail, separator]) => [...rendered(declaration), ...tail].join(separator));

const prefixed = fc
  .tuple(fc.array(prefixPool, { minLength: 1, maxLength: 3 }), declarations, separators)
  .map(([prefix, declaration, separator]) => [...prefix, ...rendered(declaration)].join(separator));

const fencedInside = fc
  .tuple(declarations, innerPool, fc.integer({ min: 1, max: 5 }))
  .map(([declaration, inner, at]) => {
    const lines = [...rendered(declaration)];
    lines.splice(at, 0, inner);
    return lines.join('\n');
  });

const bodies = fc.oneof(
  headFirst,
  prefixed,
  fencedInside,
  fc.string({ unit: 'grapheme', maxLength: 400 }),
  fc
    .array(fc.oneof(tailPool, fc.string({ maxLength: 30 })), { maxLength: 30 })
    .map((lines) => lines.join('\n')),
);

const keyLine = /^(?:closes|risks|touches|risktier|riskdomains)[:|]/u;
const fenceRun = /^(?:`{3,}|~{3,})/u;
const forbidden = ['\u0085', '\u2028', '\u2029', '\f', '\v', '\uFEFF', '<!', '<?'];

function stripped(line: string): string {
  let rest = line.normalize('NFKC').replace(/\p{Cf}/gu, '');
  let previous = '';
  while (rest !== previous) {
    previous = rest;
    rest = rest.replace(/^[\s>|#*+-]+/u, '').replace(/^\d{1,9}[.)]/u, '');
  }
  return rest;
}

function isCandidate(line: string): boolean {
  const run = fenceRun.exec(line)?.[0];
  if (run === undefined) return false;
  const info = line.slice(run.length);
  return info.toLowerCase().includes('harness') || /[^\x20-\x7e]/u.test(info);
}

function isKeyLine(line: string): boolean {
  return keyLine.test(line.toLowerCase().replace(/[\s*_`]/gu, ''));
}

function headLines(body: string): readonly string[] {
  return body.split(/\r?\n/u);
}

function closeOf(lines: readonly string[]): number {
  return lines.indexOf('```', 1);
}

function fenceInsideBlock(lines: readonly string[]): boolean {
  const close = closeOf(lines);
  const inside = lines.slice(1, close === -1 ? lines.length : close);
  return inside.some((line) => fenceRun.test(line.trim()));
}

function passesOuterRules(body: string): boolean {
  return (
    /\r(?!\n)/u.test(body) === false &&
    forbidden.every((mark) => !body.includes(mark)) &&
    headLines(body)[0] === '```harness'
  );
}

function assertAllowlisted(body: string): void {
  expect(passesOuterRules(body)).toBe(true);
  const lines = headLines(body);
  expect(fenceInsideBlock(lines)).toBe(false);
  const after = lines.slice(closeOf(lines) + 1).map(stripped);
  expect(after.filter((line) => isCandidate(line) || isKeyLine(line))).toEqual([]);
}

function assertWellFormed(body: string): void {
  const result = parseDeclaration(body);
  if (result.ok) {
    expect(pullRequestDeclarationSchema.parse(result.declaration)).toEqual(result.declaration);
    assertAllowlisted(body);
    return;
  }
  expect(problems.has(result.problem)).toBe(true);
  if (body.length <= 65_536 && passesOuterRules(body) && fenceInsideBlock(headLines(body))) {
    expect(result.problem).toBe('ambiguous_block');
  }
}

function assertReadsBack(declaration: PullRequestDeclaration): void {
  const riskDomains = riskDomainSchema.options.filter((domain) =>
    declaration.riskDomains.includes(domain),
  );
  const body = [...rendered(declaration), '', 'Adds the board.'].join('\n');
  expect(parseDeclaration(body)).toEqual({
    ok: true,
    declaration: { ...declaration, riskDomains },
  });
}

function assertTooLong(length: number): void {
  const body = 'a: '.repeat(length).slice(0, length);
  expect(parseDeclaration(body)).toEqual({ ok: false, problem: 'too_long' });
}

describe('P16 any PR body parses to one allowlisted head declaration or one closed-set problem', () => {
  it('never throws, and declares only from a head block with nothing ambiguous after it', () => {
    fc.assert(fc.property(bodies, assertWellFormed), { numRuns: 2000 });
  });

  it('reads back every head declaration it is written from, domains in schema order', () => {
    fc.assert(fc.property(declarations, assertReadsBack), { numRuns: 500 });
  });

  it('refuses every body longer than the bound', () => {
    fc.assert(fc.property(fc.integer({ min: 65_537, max: 200_000 }), assertTooLong), {
      numRuns: 20,
    });
  });
});
