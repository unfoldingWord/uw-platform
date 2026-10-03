import { providerIdSchema, type ReviewVerdict } from '@uw/contracts';
import { readsAsBlockLine } from './fenced-block.ts';

type ReviewBodySource = {
  readonly provider: string;
  readonly model: string;
  readonly verdict: ReviewVerdict;
  readonly findings: readonly string[];
};

const MODEL_LIMIT = 200;
const FINDING_LIMIT = 500;
const FINDINGS_LIMIT = 50;
const UNREPORTED_MODEL = 'unreported';
const FINDING_PREFIX = 'Finding: ';
const providerKeys: readonly string[] = ['provider'];
const invisible = /\p{Cf}/gu;
const nul = String.fromCharCode(0);
const lineBreaking = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const spaces = /\s+/gu;
const fenceCharacters = /[`~]/gu;
const outsideModel = /[^A-Za-z0-9._/:-]/gu;

const sentences: Readonly<Record<ReviewVerdict, string>> = {
  approve: 'Approved.',
  request_changes: 'Changes requested.',
};

function cut(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join('').trimEnd();
}

function oneLine(text: string): string {
  const visible = text.replace(invisible, '').replaceAll(nul, '');
  return visible.replace(lineBreaking, ' ').replace(spaces, ' ').trim();
}

function findingLine(finding: string): string {
  const neutral = finding.replace(fenceCharacters, '').replaceAll('<', '‹').replaceAll('&', '＆');
  const folded = cut(oneLine(neutral), FINDING_LIMIT);
  const safe = readsAsBlockLine(`- ${folded}`, providerKeys)
    ? `${FINDING_PREFIX}${folded}`
    : folded;
  return cut(safe, FINDING_LIMIT);
}

function modelLine(model: string): string {
  const kept = cut(model.replace(outsideModel, ''), MODEL_LIMIT);
  return kept === '' ? UNREPORTED_MODEL : kept;
}

export function reviewBody(source: ReviewBodySource): string {
  const provider = providerIdSchema.parse(source.provider);
  const findings = source.findings
    .map(findingLine)
    .filter((finding) => finding !== '')
    .slice(0, FINDINGS_LIMIT)
    .map((finding) => `- ${finding}`);
  const head = [
    '```harness-review',
    `provider: ${provider}`,
    `model: ${modelLine(source.model)}`,
    '```',
    '',
    sentences[source.verdict],
  ];
  return [...head, ...(findings.length === 0 ? [] : ['', ...findings])].join('\n');
}
