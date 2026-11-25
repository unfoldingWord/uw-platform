import type { Child } from 'hono/jsx';
import { fieldLabel } from './field.tsx';

export const railLink =
  'text-sm text-text-2 no-underline outline-offset-2 outline-accent-text hover:text-accent-text focus-visible:outline-2';

export function RailList(props: {
  readonly label: string;
  readonly attrs?: Readonly<Record<string, string>> | undefined;
  readonly children: Child;
}) {
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <p class={`m-0 ${fieldLabel}`}>{props.label}</p>
      <ul class="m-0 flex list-none flex-col gap-1 p-0" {...(props.attrs ?? {})}>
        {props.children}
      </ul>
    </div>
  );
}
