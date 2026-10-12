const TITLE_LIMIT = 200;
const REASON_LIMIT = 500;
const NO_REASON = '(no reason given)';
const invisible = /\p{Cf}/gu;
const nul = String.fromCharCode(0);
const lineBreaking = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const spaces = /\s+/gu;
const leadingDashes = /^[\s-]+/u;

type CommitSource = {
  readonly title: string;
  readonly overrideReason: string | null;
  readonly itemId: string;
  readonly number: number;
};

function oneLine(text: string, limit: number): string {
  const visible = text.replace(invisible, '').replaceAll(nul, '');
  const folded = visible.replace(lineBreaking, ' ').replace(spaces, ' ').trim();
  return Array.from(folded).slice(0, limit).join('').trimEnd();
}

function subjectOf(title: string, number: number): string {
  const subject = oneLine(title, TITLE_LIMIT).replace(leadingDashes, '');
  return `${subject} (#${number})`.trim();
}

function overrideLine(reason: string | null): string | null {
  if (reason === null) return null;
  const folded = oneLine(reason, REASON_LIMIT);
  return `Override: ${folded === '' ? NO_REASON : folded}`;
}

export function commitOf(source: CommitSource): {
  readonly title: string;
  readonly message: string;
} {
  const trailer = `Harness-Item: ${source.itemId}`;
  const override = overrideLine(source.overrideReason);
  return {
    title: subjectOf(source.title, source.number),
    message: override === null ? trailer : `${override}\n\n${trailer}`,
  };
}
