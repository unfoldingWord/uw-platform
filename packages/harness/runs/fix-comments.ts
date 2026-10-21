import type { Caller } from '../caller.ts';
import { roundFindings } from '../items/fix-offer.ts';
import { readAllEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { runScene } from './scene.ts';

type CommentPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ReviewComments = { readonly comments: readonly string[] };

export async function reviewComments(
  ports: CommentPorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<ReviewComments>> {
  const scene = await runScene(ports, caller, runId);
  if (scene.status !== 'accepted') return scene;
  if (scene.value.capability !== 'fix') return refused('not_permitted', { why: 'not_a_fix_run' });
  const { item } = scene.value;
  const events = await ports.store.transaction((tx) =>
    readAllEvents(tx, item.harnessId, item.itemId),
  );
  return accepted({ comments: roundFindings(events) });
}
