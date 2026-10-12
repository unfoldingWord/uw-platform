import {
  pullRequestDeclarationSchema,
  riskDomainSchema,
  type PullRequestDeclaration,
  type RiskDeclaration,
  type RiskDomain,
} from '@uw/contracts';
import { fencedBlock, type BlockProblem } from './fenced-block.ts';
import { normalisedIdentifier } from './identifiers.ts';

export type DeclarationProblem =
  BlockProblem | 'unknown_key' | 'duplicate_key' | 'missing_key' | 'invalid_value';

export type DeclarationParse =
  | { readonly ok: true; readonly declaration: PullRequestDeclaration }
  | { readonly ok: false; readonly problem: DeclarationProblem };

type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: DeclarationProblem };

type Fields = ReadonlyMap<string, string>;

const fieldLine = /^([a-z_]+): (.*)$/u;
const declarationKeys: readonly string[] = [
  'closes',
  'risks',
  'touches',
  'risk_tier',
  'risk_domains',
];
const knownKeys: ReadonlySet<string> = new Set(declarationKeys);

export const DECLARED_CLOSES_LIMIT = 50;
export const DECLARED_REFERENCE_LIMIT = 160;

function closesWithinLimit(closes: readonly string[]): boolean {
  return (
    closes.length <= DECLARED_CLOSES_LIMIT &&
    closes.every((reference) => reference.length <= DECLARED_REFERENCE_LIMIT)
  );
}

function refused(problem: DeclarationProblem): {
  readonly ok: false;
  readonly problem: DeclarationProblem;
} {
  return { ok: false, problem };
}

export function readFields(lines: readonly string[]): Read<Fields> {
  const fields = new Map<string, string>();
  for (const line of lines) {
    if (line === '') continue;
    const match = fieldLine.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) return refused('invalid_value');
    if (fields.has(key)) return refused('duplicate_key');
    fields.set(key, value.trim());
  }
  return { ok: true, value: fields };
}

function keysProblem(fields: Fields): DeclarationProblem | null {
  if ([...fields.keys()].some((key) => !knownKeys.has(key))) return 'unknown_key';
  if (declarationKeys.some((key) => !fields.has(key))) return 'missing_key';
  return null;
}

function listOf(value: string): readonly string[] {
  return value === 'none' ? [] : value.split(',').map((part) => part.trim());
}

function setOf(value: string): readonly string[] {
  return [...new Set(listOf(value))];
}

function inSchemaOrder(domains: readonly RiskDomain[]): RiskDomain[] {
  return riskDomainSchema.options.filter((domain) => domains.includes(domain));
}

function assemble(fields: Fields): DeclarationParse {
  const field = (key: string): string => fields.get(key) ?? '';
  const closes = setOf(field('closes'));
  if (!closesWithinLimit(closes)) return refused('invalid_value');
  const parsed = pullRequestDeclarationSchema.safeParse({
    closes,
    risks: field('risks'),
    touches: field('touches'),
    riskTier: field('risk_tier'),
    riskDomains: listOf(field('risk_domains')),
  });
  if (!parsed.success) return refused('invalid_value');
  const declaration = { ...parsed.data, riskDomains: inSchemaOrder(parsed.data.riskDomains) };
  return { ok: true, declaration };
}

export function parseDeclaration(body: string | null): DeclarationParse {
  const block = fencedBlock(body, 'harness', declarationKeys);
  if (!block.ok) return block;
  const fields = readFields(block.lines);
  if (!fields.ok) return fields;
  const problem = keysProblem(fields.value);
  return problem === null ? assemble(fields.value) : refused(problem);
}

export function declarationWithinLimit(
  declaration: PullRequestDeclaration | null,
): PullRequestDeclaration | null {
  if (declaration === null || !closesWithinLimit(declaration.closes)) return null;
  return declaration;
}

export function riskDeclarationOf(
  candidate: PullRequestDeclaration | null,
): RiskDeclaration | null {
  const declaration = declarationWithinLimit(candidate);
  if (declaration === null) return null;
  return { riskTier: declaration.riskTier, riskDomains: [...declaration.riskDomains] };
}

export function parseReviewProvider(body: string | null): string | null {
  const block = fencedBlock(body, 'harness-review', ['provider']);
  if (!block.ok) return null;
  const fields = readFields(block.lines);
  if (!fields.ok) return null;
  const provider = fields.value.get('provider');
  return provider === undefined ? null : normalisedIdentifier(provider);
}
