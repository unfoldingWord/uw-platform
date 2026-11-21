import type { PropertyDefinition } from '@uw/contracts';
import { PlatformCommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { domId } from '@uw/ui/components/text.ts';

export const COLLECTIONS_ENDPOINT = '/api/collections/commands';

const control =
  'min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-sm text-text outline-offset-2 outline-accent-text focus-visible:outline-2';

const focusRing = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

export type Choice = { readonly value: string; readonly label: string };

export type EditTarget = {
  readonly collection: string;
  readonly rowId: string;
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

export function PropertyEditor(props: { readonly target: EditTarget }) {
  const { target } = props;
  const scope = `${target.rowId}-${target.property.key}`;
  const id = domId('edit', scope);
  const label = target.property.name;
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
      <button
        type="submit"
        class={target.compact ? `sr-only focus:not-sr-only ${focusRing}` : commandButton}
      >
        {`Save ${label.toLowerCase()}`}
      </button>
    </PlatformCommandForm>
  );
}
