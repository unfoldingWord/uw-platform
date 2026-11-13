export type Choice = { readonly value: string; readonly label: string };

export function SegmentedControl(props: {
  readonly name: string;
  readonly legend: string;
  readonly choices: readonly Choice[];
  readonly selected: string;
}) {
  return (
    <fieldset class="m-0 inline-flex overflow-hidden rounded-md border border-line bg-surface p-0">
      <legend class="sr-only">{props.legend}</legend>
      {props.choices.map((choice) => (
        <label class="inline-flex cursor-pointer items-center border-r border-line px-3 py-1 text-sm font-heavy whitespace-nowrap text-text-3 outline-offset-2 outline-accent-text last:border-r-0 hover:text-text has-checked:bg-side has-checked:text-side-text has-focus-visible:outline-2">
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
