import type { Child } from 'hono/jsx';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'held';

const toneClasses: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-bg text-muted border border-line',
  info: 'bg-inspire-soft text-ocean',
  success: 'bg-cultivate-soft text-ink',
  held: 'bg-surface text-muted border border-dashed border-line',
};

export function Badge(props: { readonly tone: BadgeTone; readonly children: Child }) {
  return (
    <span
      class={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-bold ${toneClasses[props.tone]}`}
    >
      {props.children}
    </span>
  );
}
