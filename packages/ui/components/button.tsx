import type { Child } from 'hono/jsx';
import type { IconName } from '../generated/icons.ts';
import { safeHref } from './href.ts';
import { humanButton } from './human-action.tsx';
import { Icon } from './icon.tsx';
import { reasonText } from './text.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'human';
export type ButtonSize = 'md' | 'sm';
type Attributes = Readonly<Record<string, string | number | boolean | undefined>>;

const base =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border font-semibold whitespace-nowrap no-underline outline-offset-2 outline-accent-text transition-colors motion-reveal focus-visible:outline-2 aria-disabled:cursor-not-allowed';

const looks: ReadonlyMap<ButtonVariant, string> = new Map(
  Object.entries({
    primary:
      'border-accent bg-accent text-on-accent hover:brightness-95 aria-disabled:border-line-soft aria-disabled:bg-raised aria-disabled:text-text-3 aria-disabled:hover:brightness-100',
    secondary:
      'border-line bg-surface text-text hover:border-accent hover:text-accent-text aria-disabled:border-line-soft aria-disabled:bg-raised aria-disabled:text-text-3',
    ghost:
      'border-transparent bg-transparent text-text-2 hover:bg-hover hover:text-text aria-disabled:text-text-3 aria-disabled:hover:bg-transparent',
    human: humanButton,
  }) as [ButtonVariant, string][],
);

const sizes: ReadonlyMap<ButtonSize, string> = new Map([
  ['md', 'h-size-5 px-3 text-sm'],
  ['sm', 'h-size-4 px-2 text-xs'],
]);

const squares: ReadonlyMap<ButtonSize, string> = new Map([
  ['md', 'size-size-5 text-sm'],
  ['sm', 'size-size-4 text-xs'],
]);

export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  square = false,
): string {
  const box = (square ? squares : sizes).get(size) ?? '';
  return `${base} ${looks.get(variant) ?? ''} ${box}`;
}

function Reason(props: { readonly id: string | undefined; readonly reason: string | null }) {
  if (props.id === undefined || props.reason === null) return null;
  return (
    <span id={props.id} class="text-sm text-text-3">
      {reasonText(props.reason)}
    </span>
  );
}

function reasonIdOf(
  reason: string | null,
  given: string | undefined,
  name: string | undefined,
): string | undefined {
  if (reason === null) return undefined;
  return given ?? `${name ?? 'button'}-reason`;
}

function Glyph(props: { readonly icon: IconName | undefined }) {
  return props.icon === undefined ? null : <Icon name={props.icon} size={1} />;
}

export function Button(props: {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly type?: 'button' | 'submit' | undefined;
  readonly name?: string | undefined;
  readonly value?: string | undefined;
  readonly icon?: IconName | undefined;
  readonly label?: string | undefined;
  readonly disabledReason?: string | null | undefined;
  readonly reasonId?: string | undefined;
  readonly form?: string | undefined;
  readonly attrs?: Attributes | undefined;
  readonly children?: Child | undefined;
}) {
  const reason = props.disabledReason ?? null;
  const reasonId = reasonIdOf(reason, props.reasonId, props.name);
  const button = (
    <button
      type={reason === null ? (props.type ?? 'button') : 'button'}
      name={props.name}
      value={props.value}
      form={props.form}
      aria-label={props.label}
      aria-disabled={reason === null ? undefined : 'true'}
      aria-describedby={reasonId}
      class={buttonClass(props.variant, props.size)}
      {...(props.attrs ?? {})}
    >
      <Glyph icon={props.icon} />
      {props.children}
    </button>
  );
  if (reason === null) return button;
  return (
    <span class="inline-flex flex-wrap items-center gap-2">
      {button}
      <Reason id={reasonId} reason={reason} />
    </span>
  );
}

export function ButtonLink(props: {
  readonly href: string;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly icon?: IconName | undefined;
  readonly label?: string | undefined;
  readonly attrs?: Attributes | undefined;
  readonly children?: Child | undefined;
}) {
  const href = safeHref(props.href);
  if (href === undefined) return null;
  return (
    <a
      href={href}
      aria-label={props.label}
      class={buttonClass(props.variant, props.size)}
      {...(props.attrs ?? {})}
    >
      {props.icon === undefined ? null : <Icon name={props.icon} size={1} />}
      {props.children}
    </a>
  );
}

export function IconButton(props: {
  readonly icon: IconName;
  readonly label: string;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly href?: string | undefined;
  readonly type?: 'button' | 'submit' | undefined;
  readonly attrs?: Attributes | undefined;
}) {
  const look = buttonClass(props.variant ?? 'ghost', props.size, true);
  const glyph = <Icon name={props.icon} size={props.size === 'sm' ? 1 : 2} />;
  if (props.href !== undefined) {
    const href = safeHref(props.href);
    if (href === undefined) return null;
    return (
      <a
        href={href}
        aria-label={props.label}
        title={props.label}
        class={look}
        {...(props.attrs ?? {})}
      >
        {glyph}
      </a>
    );
  }
  return (
    <button
      type={props.type ?? 'button'}
      aria-label={props.label}
      title={props.label}
      class={look}
      {...(props.attrs ?? {})}
    >
      {glyph}
    </button>
  );
}
