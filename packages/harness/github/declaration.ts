import {
  pullRequestDeclarationSchema,
  riskDomainSchema,
  type PullRequestDeclaration,
  type RiskDeclaration,
  type RiskDomain,
} from '@uw/contracts';
import { normalisedIdentifier } from './identifiers.ts';

export type DeclarationProblem =
  | 'missing'
  | 'too_long'
  | 'duplicate_block'
  | 'unclosed_block'
  | 'unknown_key'
  | 'duplicate_key'
  | 'missing_key'
  | 'invalid_value';

export type DeclarationParse =
  | { readonly ok: true; readonly declaration: PullRequestDeclaration }
  | { readonly ok: false; readonly problem: DeclarationProblem };

type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: DeclarationProblem };

type Fields = ReadonlyMap<string, string>;

const maxBodyLength = 65_536;
const closingFence = '```';
const fieldLine = /^([a-z_]+): (.*)$/u;
const declarationKeys: readonly string[] = [
  'closes',
  'risks',
  'touches',
  'risk_tier',
  'risk_domains',
];
const knownKeys: ReadonlySet<string> = new Set(declarationKeys);

function refused(problem: DeclarationProblem): {
  readonly ok: false;
  readonly problem: DeclarationProblem;
} {
  return { ok: false, problem };
}

function fencedBlock(lines: readonly string[], info: string): Read<readonly string[]> {
  const opening = `${closingFence}${info}`;
  const starts = lines.flatMap((line, index) => (line === opening ? [index] : []));
  const [start] = starts;
  if (start === undefined) return refused('missing');
  if (starts.length > 1) return refused('duplicate_block');
  const end = lines.indexOf(closingFence, start + 1);
  if (end === -1) return refused('unclosed_block');
  return { ok: true, value: lines.slice(start + 1, end) };
}

function blockOf(body: string | null, info: string): Read<readonly string[]> {
  if (body === null) return refused('missing');
  if (body.length > maxBodyLength) return refused('too_long');
  const lines = body.split(/\r?\n/u).map((line) => line.trimEnd());
  return fencedBlock(lines, info);
}

function readFields(lines: readonly string[]): Read<Fields> {
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

function inSchemaOrder(domains: readonly RiskDomain[]): RiskDomain[] {
  return riskDomainSchema.options.filter((domain) => domains.includes(domain));
}

function assemble(fields: Fields): DeclarationParse {
  const field = (key: string): string => fields.get(key) ?? '';
  const parsed = pullRequestDeclarationSchema.safeParse({
    closes: listOf(field('closes')),
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
  const block = blockOf(body, 'harness');
  if (!block.ok) return block;
  const fields = readFields(block.value);
  if (!fields.ok) return fields;
  const problem = keysProblem(fields.value);
  return problem === null ? assemble(fields.value) : refused(problem);
}

export function riskDeclarationOf(
  declaration: PullRequestDeclaration | null,
): RiskDeclaration | null {
  if (declaration === null) return null;
  return { riskTier: declaration.riskTier, riskDomains: [...declaration.riskDomains] };
}

export function parseReviewProvider(body: string | null): string | null {
  const block = blockOf(body, 'harness-review');
  if (!block.ok) return null;
  const fields = readFields(block.value);
  if (!fields.ok) return null;
  const provider = fields.value.get('provider');
  return provider === undefined ? null : normalisedIdentifier(provider);
}
