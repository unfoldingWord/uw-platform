import type { Child } from 'hono/jsx';

export function PageHead(props: {
  readonly title: string;
  readonly eyebrow?: string | undefined;
  readonly lede?: Child | undefined;
  readonly actions?: Child | undefined;
  readonly titleField?: Child | undefined;
  readonly flush?: boolean | undefined;
  readonly document?: boolean | undefined;
}) {
  const big = props.document === true;
  const eyebrow = big
    ? 'm-0 mb-1 font-mono text-sm font-semibold text-accent-text'
    : 'm-0 mb-1 text-sm text-text-3';
  const heading = big
    ? 'm-0 text-2xl leading-tight font-heavy tracking-heading text-balance text-accent-text'
    : 'm-0 text-xl leading-tight font-heavy tracking-tight text-balance text-text';
  return (
    <div
      class={`flex flex-wrap items-end justify-between gap-4 ${props.flush === true ? '' : 'mb-6'}`}
    >
      <div class={props.titleField === undefined ? 'min-w-0' : 'min-w-0 flex-1'}>
        {props.eyebrow === undefined ? null : <p class={eyebrow}>{props.eyebrow}</p>}
        {props.titleField ?? <h1 class={heading}>{props.title}</h1>}
        {props.lede === undefined ? null : (
          <p class="m-0 mt-1 max-w-content text-sm text-text-3">{props.lede}</p>
        )}
      </div>
      {props.actions === undefined ? null : (
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      )}
    </div>
  );
}

const titleInput =
  'w-full min-w-0 rounded-md border-0 bg-transparent p-0 text-2xl leading-tight font-heavy tracking-heading text-accent-text outline-offset-4 outline-accent-text placeholder:text-text-3 placeholder:font-semibold hover:bg-raised focus-visible:outline-2';

export function TitleInput(props: {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly placeholder?: string | undefined;
  readonly maxLength?: number | undefined;
  readonly attrs?: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <h1 class="m-0">
      <label for={props.id} class="sr-only">
        Title
      </label>
      <input
        id={props.id}
        name={props.name}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        autocomplete="off"
        required
        class={titleInput}
        {...(props.attrs ?? {})}
      />
    </h1>
  );
}
