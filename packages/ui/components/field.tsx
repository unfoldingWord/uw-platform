import type { Child } from 'hono/jsx';
import { domId } from './text.ts';

export const fieldControl =
  'min-h-size-5 rounded-md border border-line bg-surface px-3 py-1 text-base text-text transition-colors motion-reveal hover:border-line-strong outline-offset-2 outline-accent-text focus-visible:outline-2';

const control = fieldControl;

export const fieldLabel = 'text-xs font-semibold text-text-3';

type Choice = { readonly value: string; readonly label: string };

function Labelled(props: {
  readonly id: string;
  readonly label: string;
  readonly children: Child;
}) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <label for={props.id} class={fieldLabel}>
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

function Hint(props: { readonly id: string | undefined; readonly text: string | undefined }) {
  if (props.id === undefined || props.text === undefined) return null;
  return (
    <p id={props.id} class="m-0 text-xs text-text-3">
      {props.text}
    </p>
  );
}

function hintIdOf(props: {
  readonly name: string;
  readonly scope: string;
  readonly hint?: string;
}): string | undefined {
  return props.hint === undefined ? undefined : domId('hint', props.name, props.scope);
}

export function TextField(props: {
  readonly name: string;
  readonly label: string;
  readonly scope: string;
  readonly value?: string;
  readonly required?: boolean;
  readonly maxLength: number;
  readonly hint?: string;
  readonly placeholder?: string;
}) {
  const id = domId('field', props.name, props.scope);
  const hintId = hintIdOf(props);
  return (
    <Labelled id={id} label={props.label}>
      <input
        id={id}
        type="text"
        name={props.name}
        value={props.value}
        required={props.required === true}
        maxlength={props.maxLength}
        placeholder={props.placeholder}
        aria-describedby={hintId}
        class={control}
      />
      <Hint id={hintId} text={props.hint} />
    </Labelled>
  );
}

export function TextAreaField(props: {
  readonly name: string;
  readonly label: string;
  readonly scope: string;
  readonly hint?: string;
  readonly maxLength: number;
  readonly value?: string;
  readonly rows?: number;
}) {
  const id = domId('field', props.name, props.scope);
  const hintId = hintIdOf(props);
  return (
    <Labelled id={id} label={props.label}>
      <textarea
        id={id}
        name={props.name}
        rows={props.rows ?? 4}
        maxlength={props.maxLength}
        aria-describedby={hintId}
        class={control}
      >
        {props.value ?? ''}
      </textarea>
      <Hint id={hintId} text={props.hint} />
    </Labelled>
  );
}

export function SelectField(props: {
  readonly name: string;
  readonly label: string;
  readonly scope: string;
  readonly choices: readonly Choice[];
  readonly selected?: string;
  readonly hint?: string;
}) {
  const id = domId('field', props.name, props.scope);
  const hintId = hintIdOf(props);
  return (
    <Labelled id={id} label={props.label}>
      <select id={id} name={props.name} aria-describedby={hintId} class={control}>
        {props.choices.map((choice) => (
          <option value={choice.value} selected={choice.value === props.selected}>
            {choice.label}
          </option>
        ))}
      </select>
      <Hint id={hintId} text={props.hint} />
    </Labelled>
  );
}
