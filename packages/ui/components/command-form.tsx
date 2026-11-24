import type { Child } from 'hono/jsx';
import { buttonClass } from './button.tsx';
import { domId } from './text.ts';

export const commandButton = buttonClass('secondary');

export const iconCommandButton = buttonClass('secondary', 'md');

export const primaryButton = buttonClass('primary');

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

export function PlatformCommandForm(props: {
  readonly endpoint: string;
  readonly command: string;
  readonly scope: string;
  readonly done?: string;
  readonly autosubmit?: boolean;
  readonly inline?: boolean;
  readonly children: Child;
}) {
  return (
    <form
      id={domId('form', props.command, props.scope)}
      data-command={props.command}
      data-endpoint={props.endpoint}
      data-done={props.done}
      data-autosubmit={props.autosubmit === true ? '' : undefined}
      method="post"
      action="#"
      class={`flex flex-wrap gap-2 ${props.inline === true ? 'items-center' : 'items-end'}`}
    >
      {props.children}
      <p data-outcome role="status" aria-live="polite" class="m-0 text-sm text-text-3"></p>
    </form>
  );
}

export function NewHarnessForm(props: { readonly command: string; readonly children: Child }) {
  return (
    <form
      data-command={props.command}
      data-new-workflow
      method="post"
      action="#"
      class="flex flex-col gap-5"
    >
      {props.children}
    </form>
  );
}
