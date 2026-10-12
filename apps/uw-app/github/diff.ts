import type { DiffRead } from '@uw/harness';
import { isFullSha } from './inputs.ts';
import type { GitHubSession } from './session.ts';

const DIFF_MEDIA = 'application/vnd.github.diff';
const COMPARE = 'GET /repos/{owner}/{repo}/compare/{basehead}';

type Capped = { readonly chunks: readonly Uint8Array[]; readonly over: boolean };

async function readCapped(body: ReadableStream<Uint8Array>, limit: number): Promise<Capped> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { chunks, over: false };
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { chunks, over: true };
    }
    chunks.push(value);
  }
}

function textOf(chunks: readonly Uint8Array[]): { readonly text: string; readonly bytes: number } {
  const decoder = new TextDecoder();
  const text = chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('');
  const bytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  return { text: text + decoder.decode(), bytes };
}

function usable(budget: number): boolean {
  return Number.isSafeInteger(budget) && budget >= 0;
}

export function diffRead(session: GitHubSession) {
  return async (repo: string, base: string, head: string, budget: number): Promise<DiffRead> => {
    if (!usable(budget)) return { kind: 'too_large', bytes: null };
    if (!isFullSha(base) || !isFullSha(head))
      return { kind: 'unavailable', reason: 'unprocessable' };
    const parameters = { basehead: `${base}...${head}` };
    const answer = await session.stream(COMPARE, parameters, repo, DIFF_MEDIA);
    if (!answer.ok) return { kind: 'unavailable', reason: answer.failure };
    if (answer.value.body === null) return { kind: 'unavailable', reason: 'malformed_response' };
    const read = await readCapped(answer.value.body, budget);
    if (read.over) return { kind: 'too_large', bytes: null };
    return { kind: 'diff', ...textOf(read.chunks) };
  };
}
