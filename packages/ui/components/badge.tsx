import type { Child } from 'hono/jsx';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'held';

const toneClasses: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-canvas text-text-3 border border-line',
  info: 'bg-accent-soft text-accent-text',
  success: 'bg-ok-soft text-text',
  held: 'bg-surface text-text-3 border border-dashed border-line',
};

export function Badge(props: { readonly tone: BadgeTone; readonly children: Child }) {
  return (
    <span
      class={`inline-flex items-center rounded-sm px-2 py-1 text-xs font-heavy ${toneClasses[props.tone]}`}
    >
      {props.children}
    </span>
  );
}
