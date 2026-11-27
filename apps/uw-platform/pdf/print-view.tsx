import type { FilterCondition, FilterGroup, SavedView } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { loadCollection } from '../collections/definitions.ts';
import { mayReadCollection } from '../collections/reader.ts';
import { viewById } from '../collections/view-rows.ts';
import { drawLayout } from '../views/parts/collection-draw.tsx';
import { layoutOf, monthOf } from '../views/parts/collection-scene.ts';
import { screenOf, titled, type Printable } from './print-kernel.ts';
import { canonicalJson, sha256Hex } from './provenance.ts';

function operandText(value: FilterCondition['value']): string {
  if (value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value !== 'object') return String(value);
  if (value.kind === 'date') return value.date;
  if (value.kind === 'relative') return `${value.direction} ${value.amount} ${value.unit}`;
  return value.kind;
}

function conditionText(condition: FilterCondition): string {
  const words = [condition.property, condition.operator.replaceAll('_', ' ')];
  const operand = operandText(condition.value);
  return [...words, ...(operand === '' ? [] : [operand])].join(' ');
}

function groupText(group: FilterGroup): string {
  return group.children
    .map((child) => (child.kind === 'group' ? `(${groupText(child)})` : conditionText(child)))
    .join(` ${group.conjunction} `);
}

function viewFilters(view: SavedView, month: string): readonly string[] {
  const { filter, sorts, group, layout } = view.settings;
  return [
    ...(filter === null ? [] : [`filter: ${groupText(filter)}`]),
    ...sorts.map((sort) => `sort: ${sort.property} ${sort.direction}`),
    ...(group === null ? [] : [`group: ${group.property} by ${group.by.replaceAll('_', ' ')}`]),
    ...(layout === 'calendar' ? [`month=${month}`] : []),
  ];
}

function mayReadView(view: SavedView | null, actor: Principal): view is SavedView {
  return view !== null && (view.ownerId === null || view.ownerId === actor.personId);
}

export async function printView(
  db: Database,
  actor: Principal,
  collection: string,
  viewId: string,
  at: Date,
): Promise<Printable | null> {
  const stored = await loadCollection(db, collection);
  if (stored === null || !mayReadCollection(stored, actor, at)) return null;
  const view = await viewById(db, stored, viewId);
  if (!mayReadView(view, actor)) return null;
  const month = monthOf(null, at);
  const drawn = await layoutOf(db, screenOf(db, actor, at), stored, view, { month, cursor: null });
  if (drawn.layout === null) return null;
  const html = String(await (<>{drawLayout(view.settings.layout, drawn.layout)}</>).toString());
  const params = view.settings.layout === 'calendar' ? { month } : {};
  const rowIds = drawn.layout.reply.rows.map((row) => row.id);
  const hashed = canonicalJson({ viewId, settings: view.settings, params, rowIds });
  const title = `${stored.definition.name}: ${view.settings.name}`;
  return {
    title,
    bodyHtml: titled(title, html),
    printed: {
      reference: `${stored.definition.key}/${view.settings.name}`,
      filters: viewFilters(view, month),
      hashInput: { kind: 'hash', sourceSha256: await sha256Hex(hashed), withheld: false },
    },
    areas: [stored.definition.jdArea],
    stories: [],
  };
}
