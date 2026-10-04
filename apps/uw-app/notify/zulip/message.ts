import type { Wake } from '@uw/harness';

type PostingReason = 'gate_waiting' | 'delegation_lapsed' | 'run_failed';

export const reasonSentence: Readonly<Record<PostingReason, string>> = {
  gate_waiting: 'A gate is waiting on a person',
  delegation_lapsed: 'A delegation lapsed',
  run_failed: 'A run failed',
};

const sentences: ReadonlyMap<string, string> = new Map(Object.entries(reasonSentence));

export function zulipContent(wake: Wake, appOrigin: string): string {
  const sentence = sentences.get(wake.reason) ?? '';
  const subject = wake.itemRef === null ? wake.harnessKey : `${wake.harnessKey} · ${wake.itemRef}`;
  return `${subject}: ${sentence}. ${appOrigin}${wake.link}`;
}
