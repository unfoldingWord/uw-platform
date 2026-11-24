import type { Child } from 'hono/jsx';
import type { IconName } from '../generated/icons.ts';
import { buttonClass, type ButtonVariant } from './button.tsx';
import { safeHref } from './href.ts';
import { Icon } from './icon.tsx';
import { domId } from './text.ts';

const item =
  'flex w-full cursor-pointer items-center gap-3 rounded-sm border-0 bg-transparent px-2 py-1 text-left text-base text-text no-underline outline-offset-2 outline-accent-text hover:bg-hover focus-visible:outline-2';

export function Popover(props: {
  readonly id: string;
  readonly label: string;
  readonly wide?: boolean | undefined;
  readonly role?: 'group' | 'dialog' | undefined;
  readonly children?: Child | undefined;
}) {
  const width = props.wide === true ? 'w-col-max' : 'w-aside';
  return (
    <div
      id={props.id}
      popover="auto"
      role={props.role ?? 'group'}
      aria-label={props.label}
      data-anchored=""
      class={`m-0 max-w-full flex-col gap-1 rounded-lg border-0 bg-surface p-1 text-text shadow-3 ${width} open:flex`}
    >
      {props.children}
    </div>
  );
}

export function Menu(props: {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName | undefined;
  readonly text?: string | undefined;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: 'md' | 'sm' | undefined;
  readonly wide?: boolean | undefined;
  readonly children?: Child | undefined;
}) {
  const id = domId('menu', props.id);
  const square = props.text === undefined;
  return (
    <>
      <button
        type="button"
        popovertarget={id}
        aria-label={square ? props.label : undefined}
        title={square ? props.label : undefined}
        class={buttonClass(props.variant ?? 'ghost', props.size, square)}
      >
        <Icon name={props.icon ?? 'ellipsis'} size={props.size === 'sm' ? 1 : 2} />
        {props.text}
      </button>
      <Popover id={id} label={props.label} wide={props.wide}>
        {props.children}
      </Popover>
    </>
  );
}

export function MenuLink(props: {
  readonly href: string;
  readonly icon?: IconName | undefined;
  readonly hint?: string | undefined;
  readonly children: Child;
}) {
  const href = safeHref(props.href);
  if (href === undefined) return null;
  return (
    <a href={href} class={item}>
      {props.icon === undefined ? null : <Icon name={props.icon} size={1} />}
      <span class="min-w-0 flex-1 truncate">{props.children}</span>
      {props.hint === undefined ? null : (
        <span class="font-mono text-xs text-text-3">{props.hint}</span>
      )}
    </a>
  );
}

export function MenuItem(props: {
  readonly icon?: IconName | undefined;
  readonly type?: 'button' | 'submit' | undefined;
  readonly name?: string | undefined;
  readonly value?: string | undefined;
  readonly form?: string | undefined;
  readonly attrs?: Readonly<Record<string, string | undefined>> | undefined;
  readonly children: Child;
}) {
  return (
    <button
      type={props.type ?? 'button'}
      name={props.name}
      value={props.value}
      form={props.form}
      class={item}
      {...(props.attrs ?? {})}
    >
      {props.icon === undefined ? null : <Icon name={props.icon} size={1} />}
      <span class="min-w-0 flex-1 truncate">{props.children}</span>
    </button>
  );
}

export function MenuRule() {
  return <hr aria-hidden="true" class="mt-1 mb-1 h-px border-0 bg-line-soft" />;
}

export function MenuNote(props: { readonly children: Child }) {
  return <p class="m-0 px-2 py-1 text-sm text-text-3">{props.children}</p>;
}
