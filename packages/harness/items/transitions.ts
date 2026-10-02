import type { Principal, Stage } from '@uw/contracts';
import { bareAgent } from '../access.ts';
import { draft, type EventDraft } from './record.ts';

export type Exit =
  | { readonly kind: 'forward'; readonly from: Stage; readonly to: Stage | null }
  | { readonly kind: 'loop'; readonly from: Stage; readonly to: Stage };

export function resolveExit(stages: readonly Stage[], from: Stage, to: string | null): Exit | null {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const next = ordered.find((stage) => stage.position > from.position) ?? null;
  if (to === null || (next !== null && to === next.key)) return { kind: 'forward', from, to: next };
  const fed = from.feeds.includes(to) ? ordered.find((stage) => stage.key === to) : undefined;
  return fed === undefined ? null : { kind: 'loop', from, to: fed };
}

export function isOccasionalTweak(stages: readonly Stage[], exit: Exit): boolean {
  if (exit.kind !== 'loop') return false;
  const lowest = Math.min(...stages.map((stage) => stage.position));
  return exit.to.position === lowest;
}

export function unattendedLoop(exit: Exit, actor: Principal, delegationId: string | null): boolean {
  if (exit.kind !== 'loop' || delegationId !== null) return false;
  return !actor.interactive || bareAgent(actor.identity);
}

export function exitDrafts(exit: Exit): readonly EventDraft[] {
  if (exit.kind === 'loop') {
    return [draft('loop_edge_taken', { from: exit.from.key, to: exit.to.key })];
  }
  return [draft('stage_advanced', { from: exit.from.key, to: exit.to?.key ?? null })];
}
