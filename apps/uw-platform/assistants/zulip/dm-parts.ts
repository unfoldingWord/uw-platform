import type { UntrustedPart } from '@uw/contracts';
import { splitTranscript, transcriptParts } from '@uw/harness';
import { fenceQuotes } from './quotes.ts';

export type DmRequest = {
  readonly note: string;
  readonly untrustedParts: readonly UntrustedPart[];
};

const PARTS_TOTAL_MOST = 100_000;
const PART_MOST = 50_000;
const PARTS_MOST = 20;

function quotePart(text: string): readonly UntrustedPart[] {
  const split = splitTranscript(text);
  return split.transcript === null
    ? [{ source: 'chat_quote', text: text.slice(0, PART_MOST) }]
    : transcriptParts(text, PART_MOST);
}

function bounded(parts: readonly UntrustedPart[]): readonly UntrustedPart[] {
  const kept: UntrustedPart[] = [];
  let left = PARTS_TOTAL_MOST;
  for (const part of parts.slice(0, PARTS_MOST)) {
    const text = part.text.slice(0, left);
    if (text.trim() === '') continue;
    kept.push({ source: part.source, text });
    left -= text.length;
  }
  return kept;
}

export function dmRequestOf(content: string): DmRequest {
  const fenced = fenceQuotes(content);
  const split = splitTranscript(fenced.note);
  const pasted =
    split.transcript === null ? [] : transcriptParts(split.transcript, PARTS_TOTAL_MOST);
  return {
    note: split.before,
    untrustedParts: bounded([...pasted, ...fenced.quotes.flatMap(quotePart)]),
  };
}
