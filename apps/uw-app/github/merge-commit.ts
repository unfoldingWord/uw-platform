const TITLE_LIMIT = 200;
const REASON_LIMIT = 500;
const lineBreaking = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const spaces = /\s+/gu;

type CommitSource = {
  readonly title: string;
  readonly overrideReason: string | null;
  readonly itemId: string;
  readonly number: number;
};

function oneLine(text: string, limit: number): string {
  const folded = text.replace(lineBreaking, ' ').replace(spaces, ' ').trim();
  return Array.from(folded).slice(0, limit).join('').trimEnd();
}

export function commitOf(source: CommitSource): {
  readonly title: string;
  readonly message: string;
} {
  const title = `${oneLine(source.title, TITLE_LIMIT)} (#${source.number})`.trim();
  const reason = source.overrideReason === null ? '' : oneLine(source.overrideReason, REASON_LIMIT);
  const trailer = `Harness-Item: ${source.itemId}`;
  return { title, message: reason === '' ? trailer : `Override: ${reason}\n\n${trailer}` };
}
