import type { Child } from 'hono/jsx';
import { domId } from './text.ts';

export const commandButton =
  'rounded-md border border-ocean bg-surface px-3 py-2 text-sm font-bold text-ocean outline-offset-2 outline-focus focus-visible:outline-2 aria-disabled:cursor-not-allowed aria-disabled:text-muted';

export function CommandForm(props: {
  readonly harnessId: string;
  readonly command: string;
  readonly itemId?: string;
  readonly children: Child;
}) {
  return (
    <form
      id={domId('form', props.command, props.itemId ?? props.harnessId)}
      data-command={props.command}
      data-harness={props.harnessId}
      method="post"
      action="#"
      class="flex flex-wrap items-end gap-2"
    >
      {props.children}
      <p data-outcome role="status" aria-live="polite" class="m-0 text-sm text-muted"></p>
    </form>
  );
}
