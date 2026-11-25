const input =
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
        class={input}
        {...(props.attrs ?? {})}
      />
    </h1>
  );
}
