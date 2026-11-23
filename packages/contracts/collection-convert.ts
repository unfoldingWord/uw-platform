import type { PropertyConfig, PropertyDefinition, SelectOption } from './collections.ts';
import { isStoredType } from './collections.ts';
import { emptyValue, propertyValueSchema } from './collection-values.ts';

export type Converted = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

type Kind = 'textual' | 'number' | 'choice' | 'choices' | 'person' | 'date' | 'range' | 'other';

const kindByType: Readonly<Record<string, Kind>> = {
  text: 'textual',
  url: 'textual',
  email: 'textual',
  phone: 'textual',
  title: 'textual',
  number: 'number',
  select: 'choice',
  status: 'choice',
  multi_select: 'choices',
  person: 'person',
  date: 'date',
  date_range: 'range',
};

const kindOf = (config: PropertyConfig): Kind => kindByType[config.type] ?? 'other';

function numberFrom(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '' || !/^[-0-9.]+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function optionsOf(config: PropertyConfig): readonly SelectOption[] {
  if (config.type === 'select' || config.type === 'status' || config.type === 'multi_select') {
    return config.options;
  }
  return [];
}

function matchOption(options: readonly SelectOption[], text: string): string | null {
  const wanted = text.trim().toLowerCase();
  const found = options.find((o) => o.id === text || o.name.trim().toLowerCase() === wanted);
  return found?.id ?? null;
}

function nameOf(options: readonly SelectOption[], id: unknown): string | null {
  return options.find((option) => option.id === id)?.name ?? null;
}

type Step = (value: unknown, from: PropertyConfig, to: PropertyConfig) => unknown;

const steps: Readonly<Record<string, Step>> = {
  'textual>number': (value) => numberFrom(String(value)),
  'number>textual': (value) => String(value),
  'textual>textual': (value) => String(value),
  'textual>choice': (value, _from, to) => matchOption(optionsOf(to), String(value)) ?? undefined,
  'choice>textual': (value, from) => nameOf(optionsOf(from), value) ?? undefined,
  'choice>choice': (value, from, to) =>
    matchOption(optionsOf(to), nameOf(optionsOf(from), value) ?? String(value)) ?? undefined,
  'choice>choices': (value, from, to) => {
    const id = matchOption(optionsOf(to), nameOf(optionsOf(from), value) ?? String(value));
    return id === null ? undefined : [id];
  },
  'choices>choice': (value, from, to) => {
    if (!Array.isArray(value) || value.length !== 1) return undefined;
    return matchOption(optionsOf(to), nameOf(optionsOf(from), value[0]) ?? '') ?? undefined;
  },
  'choices>choices': (value, from, to) => {
    if (!Array.isArray(value)) return undefined;
    const ids = value.map((id) => matchOption(optionsOf(to), nameOf(optionsOf(from), id) ?? ''));
    return ids.some((id) => id === null) ? undefined : ids;
  },
  'person>person': (value, _from, to) => {
    const list = Array.isArray(value) ? value : [value];
    if (to.type === 'person' && to.multiple) return list;
    return list.length === 1 ? list[0] : undefined;
  },
  'date>date': (value) => value,
  'date>range': (value) => ({ start: value, end: null }),
  'range>date': (value) =>
    typeof value === 'object' && value !== null && 'start' in value ? value.start : undefined,
  'range>range': (value) => value,
};

function stepFor(from: PropertyConfig, to: PropertyConfig): Step | null {
  if (from.type === to.type && kindOf(from) === 'other') return (value) => value;
  return steps[`${kindOf(from)}>${kindOf(to)}`] ?? null;
}

export function typeChangeAllowed(from: PropertyConfig, to: PropertyConfig): boolean {
  if (!isStoredType(from.type) || !isStoredType(to.type)) return false;
  if (from.type === 'title' || to.type === 'title') return false;
  return stepFor(from, to) !== null;
}

export function convertValue(
  from: PropertyDefinition,
  to: PropertyDefinition,
  value: unknown,
): Converted {
  if (emptyValue(value)) return to.required ? { ok: false } : { ok: true, value: null };
  const step = stepFor(from.config, to.config);
  const schema = propertyValueSchema(to);
  if (step === null || schema === null) return { ok: false };
  const next = step(value, from.config, to.config);
  if (next === undefined) return { ok: false };
  const parsed = schema.safeParse(next);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
