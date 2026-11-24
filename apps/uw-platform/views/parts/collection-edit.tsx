import type { Child } from 'hono/jsx';
import type { PropertyDefinition } from '@uw/contracts';
import { Button, buttonClass } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { fieldControl } from '@uw/ui/components/field.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { domId } from '@uw/ui/components/text.ts';

export const COLLECTIONS_ENDPOINT = '/api/collections/commands';

const control = `min-w-0 ${fieldControl}`;

const focusRing = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

export type Choice = { readonly value: string; readonly label: string };

export type EditTarget = {
  readonly collection: string;
  readonly rowId: string;
  readonly rowTitle: string;
  readonly property: PropertyDefinition;
  readonly value: unknown;
  readonly compact: boolean;
  readonly people: readonly Choice[];
  readonly rows: readonly Choice[];
};

type Kind = 'text' | 'number' | 'date' | 'range' | 'single' | 'boolean' | 'list';

const fixedKinds: ReadonlyMap<string, Kind> = new Map<string, Kind>([
  ['number', 'number'],
  ['date', 'date'],
  ['date_range', 'range'],
  ['checkbox', 'boolean'],
  ['select', 'single'],
  ['status', 'single'],
  ['multi_select', 'list'],
]);

function kindOf(property: PropertyDefinition): Kind {
  const { config } = property;
  const fixed = fixedKinds.get(config.type);
  if (fixed !== undefined) return fixed;
  if (config.type === 'person') return config.multiple ? 'list' : 'single';
  if (config.type === 'relation') return config.relation.multiple ? 'list' : 'single';
  return 'text';
}

function choicesOf(target: EditTarget): readonly Choice[] {
  const { config } = target.property;
  if (config.type === 'select' || config.type === 'status' || config.type === 'multi_select') {
    return config.options.map((option) => ({ value: option.id, label: option.name }));
  }
  return config.type === 'person' ? target.people : target.rows;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'id' in value) return String(value.id);
  return String(value);
}

function selectedIds(value: unknown): readonly string[] {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return list.map(textOf);
}

function inputType(target: EditTarget): string {
  const { type } = target.property.config;
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  if (type === 'email') return 'email';
  if (type === 'url') return 'url';
  return 'text';
}

function Single(props: {
  readonly target: EditTarget;
  readonly id: string;
  readonly label: string;
}) {
  const chosen = selectedIds(props.target.value)[0] ?? '';
  return (
    <select id={props.id} name="value" aria-label={props.label} class={control}>
      <option value="" selected={chosen === ''}>
        None
      </option>
      {choicesOf(props.target).map((choice) => (
        <option value={choice.value} selected={choice.value === chosen}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

function List(props: { readonly target: EditTarget; readonly label: string }) {
  const chosen = new Set(selectedIds(props.target.value));
  return (
    <fieldset class="m-0 flex flex-wrap gap-2 border-0 p-0">
      <legend class="sr-only">{props.label}</legend>
      {choicesOf(props.target).map((choice) => (
        <label class="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            name={`value.${choice.value}`}
            value={choice.value}
            checked={chosen.has(choice.value)}
            class="outline-offset-2 outline-accent-text focus-visible:outline-2"
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
}

function Range(props: { readonly target: EditTarget; readonly label: string }) {
  const value = props.target.value;
  const range =
    typeof value === 'object' && value !== null
      ? (value as { start?: string; end?: string | null })
      : {};
  return (
    <span class="flex flex-wrap gap-1">
      <input
        type="date"
        name="start"
        value={range.start ?? ''}
        aria-label={`${props.label} start`}
        class={control}
      />
      <input
        type="date"
        name="end"
        value={range.end ?? ''}
        aria-label={`${props.label} end`}
        class={control}
      />
    </span>
  );
}

function YesNo(props: {
  readonly target: EditTarget;
  readonly id: string;
  readonly label: string;
}) {
  const on = props.target.value === true;
  return (
    <select id={props.id} name="value" aria-label={props.label} class={control}>
      <option value="false" selected={!on}>
        No
      </option>
      <option value="true" selected={on}>
        Yes
      </option>
    </select>
  );
}

function Control(props: {
  readonly target: EditTarget;
  readonly id: string;
  readonly label: string;
}) {
  const kind = kindOf(props.target.property);
  if (kind === 'single') return <Single {...props} />;
  if (kind === 'list') return <List target={props.target} label={props.label} />;
  if (kind === 'range') return <Range target={props.target} label={props.label} />;
  if (kind === 'boolean') return <YesNo {...props} />;
  const multiline =
    props.target.property.config.type === 'text' && props.target.property.config.multiline;
  if (multiline && !props.target.compact) {
    return (
      <textarea id={props.id} name="value" rows={4} aria-label={props.label} class={control}>
        {textOf(props.target.value)}
      </textarea>
    );
  }
  return (
    <input
      id={props.id}
      type={inputType(props.target)}
      name="value"
      value={textOf(props.target.value)}
      aria-label={props.label}
      class={control}
    />
  );
}

function SaveButton(props: { readonly compact: boolean; readonly label: string }) {
  if (props.compact) {
    return (
      <button type="submit" class={`sr-only focus:not-sr-only ${focusRing}`}>
        {`Save ${props.label}`}
      </button>
    );
  }
  return (
    <Button type="submit" variant="human" size="sm" label={`Save ${props.label}`}>
      Save
    </Button>
  );
}

export function PropertyEditor(props: { readonly target: EditTarget }) {
  const { target } = props;
  const scope = `${target.rowId}-${target.property.key}`;
  const id = domId('edit', scope);
  const label = `${target.property.name} of ${target.rowTitle === '' ? 'Untitled' : target.rowTitle}`;
  return (
    <PlatformCommandForm
      endpoint={COLLECTIONS_ENDPOINT}
      command="set_property"
      scope={scope}
      done="Saved"
      autosubmit
      inline
    >
      <input type="hidden" name="collection" value={target.collection} />
      <input type="hidden" name="rowId" value={target.rowId} />
      <input type="hidden" name="property" value={target.property.key} />
      <input type="hidden" name="valueKind" value={kindOf(target.property)} />
      <Control target={target} id={id} label={label} />
      <SaveButton compact={target.compact} label={label} />
    </PlatformCommandForm>
  );
}

const pencil =
  'absolute top-0 right-0 grid size-size-4 cursor-pointer list-none place-items-center rounded-sm text-text-3 opacity-0 transition-opacity motion-reveal outline-offset-2 outline-accent-text hover:bg-hover hover:text-text focus-visible:opacity-100 focus-visible:outline-2 group-focus-within/prop:opacity-100 group-hover/prop:opacity-100 group-open/edit:opacity-100 pointer-coarse:opacity-100';

export function EditInPlace(props: {
  readonly id: string;
  readonly open: boolean;
  readonly label: string;
  readonly editor: Child;
  readonly children: Child;
}) {
  return (
    <div class="group/prop relative flex w-full min-w-0 flex-col pr-size-5">
      <details id={props.id} open={props.open} class="group/edit peer">
        <summary class={pencil}>
          <Icon name="pen" size={1} class="group-open/edit:hidden" />
          <Icon name="xmark" size={1} class="hidden group-open/edit:block" />
          <span class="sr-only">{props.label}</span>
        </summary>
        <div class="flex flex-col gap-3">{props.editor}</div>
      </details>
      <div class="flex min-w-0 flex-col items-start gap-1 break-words text-text peer-open:hidden">
        {props.children}
      </div>
    </div>
  );
}

export function Confirmed(props: {
  readonly opener: string;
  readonly subject: string;
  readonly loss: string;
  readonly children: Child;
}) {
  return (
    <details>
      <summary class={`${buttonClass('ghost', 'sm')} list-none`}>
        {props.opener}
        <span class="sr-only">{` ${props.subject}`}</span>
      </summary>
      <div class="absolute top-full right-0 z-10 mt-1 flex w-col-max max-w-full flex-col gap-3 rounded-lg bg-surface p-3 shadow-3">
        <p class="m-0 text-sm break-words text-text">{props.loss}</p>
        {props.children}
      </div>
    </details>
  );
}

export function Fields(props: { readonly children: Child }) {
  return <div class="flex w-full min-w-0 flex-col gap-4">{props.children}</div>;
}

export function Submit(props: { readonly children: Child }) {
  return (
    <div class="flex w-full justify-end">
      <Button type="submit">{props.children}</Button>
    </div>
  );
}
