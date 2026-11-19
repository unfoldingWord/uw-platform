import type { Child } from 'hono/jsx';
import { humanBadge } from './human-action.tsx';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'held' | 'person';

const toneClasses: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-hover text-text-3',
  info: 'bg-accent-soft text-accent-text',
  success: 'bg-ok-soft text-ok-text',
  held: 'border border-dashed border-line bg-surface text-text-3',
  person: humanBadge,
};

export function Badge(props: { readonly tone: BadgeTone; readonly children: Child }) {
  return (
    <span
      class={`inline-flex items-center gap-1 rounded-sm px-1 text-xs leading-normal font-heavy whitespace-nowrap ${toneClasses[props.tone]}`}
    >
      {props.children}
    </span>
  );
}
