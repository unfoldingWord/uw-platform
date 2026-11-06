export type Choice = { readonly value: string; readonly label: string };

export function SegmentedControl(props: {
  readonly name: string;
  readonly legend: string;
  readonly choices: readonly Choice[];
  readonly selected: string;
}) {
  return (
    <fieldset class="m-0 inline-flex flex-wrap gap-1 rounded-md border border-line bg-surface p-1">
      <legend class="sr-only">{props.legend}</legend>
      {props.choices.map((choice) => (
        <label class="inline-flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm text-text has-checked:bg-accent-soft">
          <input
            type="radio"
            name={props.name}
            value={choice.value}
            checked={choice.value === props.selected}
            class="accent-accent outline-offset-2 outline-accent-text focus-visible:outline-2"
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
}
