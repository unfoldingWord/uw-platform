import type { UntrustedPart } from '@uw/contracts';

export type TranscriptSplit = { readonly before: string; readonly transcript: string | null };

const PART_MOST = 50_000;
const CUES_LEAST = 3;
const HEADER = /^\s*WEBVTT\b/;
const TRANSCRIPT_FILE = /\.(vtt|srt)$/i;
const DIGITS = /^\d+$/;
const SPEAKER_WORDS_MOST = 8;

function isClock(token: string, fraction: boolean): boolean {
  const bare = token.replace(/^\[/, '').replace(/\]$/, '');
  const [main = '', part, extra] = bare.split(/[.,]/);
  if (extra !== undefined || (part === undefined) === fraction) return false;
  if (part !== undefined && (!DIGITS.test(part) || part.length > 3)) return false;
  const pieces = main.split(':');
  if (pieces.length < 2 || pieces.length > 3) return false;
  return pieces.every(
    (piece, n) => DIGITS.test(piece) && (n === 0 ? piece.length <= 2 : piece.length === 2),
  );
}

function isCue(line: string): boolean {
  const [from = '', to, extra] = line.split('-->');
  if (to === undefined || extra !== undefined) return false;
  const until = to.trim().split(/\s/)[0] ?? '';
  return isClock(from.trim(), true) && isClock(until, true);
}

function isStampFirst(words: readonly string[], line: string): boolean {
  const first = words[0] ?? '';
  return isClock(first, false) && line.slice(line.indexOf(first) + first.length).includes(': ');
}

function isSpeakerFirst(words: readonly string[], line: string): boolean {
  const last = words.at(-1) ?? '';
  if (words.length < 2 || words.length > SPEAKER_WORDS_MOST || !isClock(last, false)) return false;
  return !line.slice(0, line.lastIndexOf(last)).includes(':');
}

function marks(line: string): boolean {
  const words = line.trim().split(/\s+/);
  return isCue(line) || isStampFirst(words, line) || isSpeakerFirst(words, line);
}

export function splitTranscript(text: string): TranscriptSplit {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => HEADER.test(line) || marks(line));
  if (start < 0) return { before: text, transcript: null };
  const rest = lines.slice(start);
  if (rest.filter(marks).length < CUES_LEAST) return { before: text, transcript: null };
  return { before: lines.slice(0, start).join('\n').trim(), transcript: rest.join('\n').trim() };
}

export function isTranscriptAttachment(filename: string, text: string): boolean {
  return TRANSCRIPT_FILE.test(filename) || splitTranscript(text).transcript !== null;
}

export function transcriptParts(transcript: string, room: number): readonly UntrustedPart[] {
  const kept = transcript.slice(0, Math.max(0, room));
  const parts: UntrustedPart[] = [];
  for (let from = 0; from < kept.length; from += PART_MOST) {
    const text = kept.slice(from, from + PART_MOST);
    if (text.trim() !== '') parts.push({ source: 'meeting_transcript', text });
  }
  return parts;
}
