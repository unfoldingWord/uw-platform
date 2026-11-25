import type { Child } from 'hono/jsx';
import { domId } from './text.ts';

export function SectionHeading(props: {
  readonly id?: string | undefined;
  readonly title: string;
  readonly sub?: Child | undefined;
  readonly actions?: Child | undefined;
}) {
  return (
    <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <h2 id={props.id} class="m-0 text-md leading-snug font-heavy text-text">
        {props.title}
      </h2>
      {props.sub === undefined ? null : <span class="text-sm text-text-3">{props.sub}</span>}
      {props.actions === undefined ? null : (
        <span class="ml-auto flex flex-wrap items-center gap-2">{props.actions}</span>
      )}
    </div>
  );
}

export function Section(props: {
  readonly title?: string | undefined;
  readonly headingId?: string | undefined;
  readonly attrs?: Readonly<Record<string, string | undefined>> | undefined;
  readonly sub?: Child | undefined;
  readonly actions?: Child | undefined;
  readonly flush?: boolean | undefined;
  readonly tight?: boolean | undefined;
  readonly children?: Child | undefined;
}) {
  const headingId =
    props.title === undefined ? undefined : (props.headingId ?? domId('section', props.title));
  const body = props.flush === true ? 'min-w-0 overflow-x-auto' : 'flex min-w-0 flex-col gap-3';
  return (
    <section
      aria-labelledby={headingId}
      class={`flex min-w-0 flex-col text-text ${props.tight === true ? 'gap-3' : 'gap-4'}`}
      {...(props.attrs ?? {})}
    >
      {props.title === undefined ? null : (
        <SectionHeading
          id={headingId}
          title={props.title}
          sub={props.sub}
          actions={props.actions}
        />
      )}
      <div class={body}>{props.children}</div>
    </section>
  );
}

export function Hairline() {
  return <hr aria-hidden="true" class="m-0 h-px border-0 bg-line-soft" />;
}
