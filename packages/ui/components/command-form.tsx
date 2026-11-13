import type { Child } from 'hono/jsx';
import { domId } from './text.ts';

export const commandButton =
  'inline-flex items-center rounded-md border border-line bg-surface px-3 py-1 text-sm font-heavy text-text outline-offset-2 outline-accent-text hover:border-accent hover:text-accent-text focus-visible:outline-2 aria-disabled:cursor-not-allowed aria-disabled:text-text-3';

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
      <p data-outcome role="status" aria-live="polite" class="m-0 text-sm text-text-3"></p>
    </form>
  );
}
