import type { Child } from 'hono/jsx';
import { domId } from './text.ts';

const control =
  'rounded-md border border-line bg-surface px-3 py-2 text-ink outline-offset-2 outline-focus focus-visible:outline-2';

type Choice = { readonly value: string; readonly label: string };

function Labelled(props: {
  readonly id: string;
  readonly label: string;
  readonly children: Child;
}) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <label for={props.id} class="text-sm font-bold text-ink">
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

export function TextField(props: {
  readonly name: string;
  readonly label: string;
  readonly scope: string;
  readonly value?: string;
  readonly required?: boolean;
  readonly maxLength: number;
}) {
  const id = domId('field', props.name, props.scope);
  return (
    <Labelled id={id} label={props.label}>
      <input
        id={id}
        type="text"
        name={props.name}
        value={props.value}
        required={props.required === true}
        maxlength={props.maxLength}
        class={control}
      />
    </Labelled>
  );
}

export function TextAreaField(props: {
  readonly name: string;
  readonly label: string;
  readonly scope: string;
  readonly hint?: string;
  readonly maxLength: number;
}) {
  const id = domId('field', props.name, props.scope);
  const hintId = props.hint === undefined ? undefined : domId('hint', props.name, props.scope);
  return (
    <Labelled id={id} label={props.label}>
      <textarea
        id={id}
        name={props.name}
        rows={4}
        maxlength={props.maxLength}
        aria-describedby={hintId}
        class={control}
      ></textarea>
      {props.hint === undefined ? null : (
        <p id={hintId} class="m-0 text-xs text-muted">
          {props.hint}
        </p>
      )}
    </Labelled>
  );
}

export function SelectField(props: {
  readonly name: string;
  readonly label: string;
  readonly scope: string;
  readonly choices: readonly Choice[];
  readonly selected?: string;
}) {
  const id = domId('field', props.name, props.scope);
  return (
    <Labelled id={id} label={props.label}>
      <select id={id} name={props.name} class={control}>
        {props.choices.map((choice) => (
          <option value={choice.value} selected={choice.value === props.selected}>
            {choice.label}
          </option>
        ))}
      </select>
    </Labelled>
  );
}
