export type Choice = { readonly value: string; readonly label: string };

export function SegmentedControl(props: {
  readonly name: string;
  readonly legend: string;
  readonly choices: readonly Choice[];
  readonly selected: string;
}) {
  return (
    <fieldset class="m-0 inline-flex gap-1 rounded-md bg-raised p-1">
      <legend class="sr-only">{props.legend}</legend>
      {props.choices.map((choice) => (
        <label class="inline-flex h-size-4 cursor-pointer items-center rounded-sm px-2 text-sm font-semibold whitespace-nowrap text-text-3 outline-offset-2 outline-accent-text transition-colors motion-reveal hover:text-text has-checked:bg-surface has-checked:text-text has-checked:shadow-1 has-focus-visible:outline-2">
          <input
            type="radio"
            name={props.name}
            value={choice.value}
            checked={choice.value === props.selected}
            class="sr-only"
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
}

export type CardChoice = Choice & { readonly detail: string; readonly summary: string };

export function ChoiceCards(props: {
  readonly name: string;
  readonly legend: string;
  readonly hint: string;
  readonly choices: readonly CardChoice[];
  readonly selected: string;
}) {
  return (
    <fieldset class="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend class="mb-1 p-0 text-xs font-semibold text-text-3">{props.legend}</legend>
      <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
        {props.choices.map((choice) => (
          <label class="flex cursor-pointer gap-2 rounded-md border border-line bg-surface p-3 transition-colors motion-reveal hover:border-line-strong has-checked:border-accent has-checked:bg-accent-soft">
            <input
              type="radio"
              name={props.name}
              value={choice.value}
              checked={choice.value === props.selected}
              class="mt-1 outline-offset-2 outline-accent-text focus-visible:outline-2"
            />
            <span class="flex min-w-0 flex-col gap-1">
              <span class="text-sm font-semibold text-text">{choice.label}</span>
              <span class="text-xs font-semibold text-text-3">{choice.detail}</span>
              <span class="text-xs text-text-2">{choice.summary}</span>
            </span>
          </label>
        ))}
      </div>
      <p class="m-0 text-xs text-text-3">{props.hint}</p>
    </fieldset>
  );
}
