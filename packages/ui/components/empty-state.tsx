import type { Child } from 'hono/jsx';

export function EmptyState(props: {
  readonly title: string;
  readonly text?: string | undefined;
  readonly action?: Child | undefined;
}) {
  return (
    <div class="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line p-6">
      <p class="m-0 text-md font-heavy text-text">{props.title}</p>
      {props.text === undefined ? null : <p class="m-0 text-sm text-text-3">{props.text}</p>}
      {props.action === undefined ? null : <div class="mt-2">{props.action}</div>}
    </div>
  );
}
