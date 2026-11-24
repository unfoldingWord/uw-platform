import type { Child } from 'hono/jsx';
import {
  readThroughValueSchema,
  type CollectionRow,
  type PropertyDefinition,
  type SelectOption,
} from '@uw/contracts';
import { Badge, type BadgeTone } from '@uw/ui/components/badge.tsx';
import { safeHref } from '@uw/ui/components/href.ts';
import { PersonChip } from '@uw/ui/components/person-chip.tsx';
import { cellText, personTypes, valueOf } from '../../collections/display.ts';
import { collectionRowPath } from './paths.ts';
import type { PersonChips } from './person.tsx';

const quiet = 'text-text-3';

export const cellLink =
  'font-semibold text-accent-text underline underline-offset-2 outline-offset-2 outline-accent-text focus-visible:outline-2';

function optionsOf(property: PropertyDefinition): readonly SelectOption[] {
  const { config } = property;
  if (config.type === 'select' || config.type === 'status' || config.type === 'multi_select') {
    return config.options;
  }
  return [];
}

function OptionBadge(props: { readonly property: PropertyDefinition; readonly id: unknown }) {
  const found = optionsOf(props.property).find((option) => option.id === props.id);
  const tone: BadgeTone = found?.tone ?? 'neutral';
  return <Badge tone={tone}>{found?.name ?? String(props.id)}</Badge>;
}

type Linked = { readonly id: string; readonly title: string };

function isLinked(value: unknown): value is Linked {
  return typeof value === 'object' && value !== null && 'id' in value && 'title' in value;
}

function Relations(props: {
  readonly property: PropertyDefinition;
  readonly value: readonly unknown[];
}) {
  const target =
    props.property.config.type === 'relation' ? props.property.config.relation.target : '';
  return (
    <span class="flex flex-wrap gap-x-2">
      {props.value.filter(isLinked).map((item) => (
        <a href={collectionRowPath(target, item.id)} class={cellLink}>
          {item.title}
        </a>
      ))}
    </span>
  );
}

function Choices(props: {
  readonly property: PropertyDefinition;
  readonly value: readonly unknown[];
}) {
  return (
    <span class="flex flex-wrap gap-1">
      {props.value.map((id) => (
        <OptionBadge property={props.property} id={id} />
      ))}
    </span>
  );
}

function Link(props: { readonly href: string; readonly text: string }) {
  const href = safeHref(props.href);
  if (href === undefined) return <span>{props.text}</span>;
  return (
    <a href={href} class={cellLink} rel="noopener noreferrer">
      {props.text}
    </a>
  );
}

type Special = (property: PropertyDefinition, value: unknown) => Child | undefined;

const listShown: Special = (property, value) => {
  if (!Array.isArray(value)) return undefined;
  if (property.config.type === 'relation') return <Relations property={property} value={value} />;
  if (property.config.type === 'multi_select') return <Choices property={property} value={value} />;
  return undefined;
};

const textShown: Special = (property, value) => {
  if (typeof value !== 'string') return undefined;
  const { type } = property.config;
  if (type === 'select' || type === 'status') return <OptionBadge property={property} id={value} />;
  if (type === 'url') return <Link href={value} text={value} />;
  return undefined;
};

const readThroughShown: Special = (property, value) =>
  readThroughValueSchema.safeParse(value).success ? (
    <span class={quiet}>{cellText(property, value, new Map())}</span>
  ) : undefined;

function People(props: { readonly value: unknown; readonly people: PersonChips }) {
  const ids = (Array.isArray(props.value) ? props.value : [props.value]).map(String);
  return (
    <span class="flex min-w-0 max-w-full flex-wrap gap-x-3 gap-y-1">
      {ids.map((id) => {
        const person = props.people.get(id);
        return person === undefined ? <span>{id}</span> : <PersonChip person={person} />;
      })}
    </span>
  );
}

function special(property: PropertyDefinition, value: unknown): Child | undefined {
  return (
    listShown(property, value) ?? textShown(property, value) ?? readThroughShown(property, value)
  );
}

export function CellValue(props: {
  readonly property: PropertyDefinition;
  readonly value: unknown;
  readonly people: PersonChips;
}) {
  const { property, value } = props;
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return <span class={quiet}>—</span>;
  }
  if (personTypes.has(property.config.type)) {
    return <People value={value} people={props.people} />;
  }
  const shown = special(property, value);
  if (shown !== undefined) return <>{shown}</>;
  return <span>{cellText(property, value, new Map())}</span>;
}

export function RowTitle(props: { readonly collection: string; readonly row: CollectionRow }) {
  return (
    <a href={collectionRowPath(props.collection, props.row.id)} class={cellLink}>
      {props.row.title === '' ? 'Untitled' : props.row.title}
    </a>
  );
}

export function propertyValue(row: CollectionRow, key: string): unknown {
  return valueOf(row, key);
}
