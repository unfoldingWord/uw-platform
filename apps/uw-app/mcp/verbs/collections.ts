import {
  loadCollection,
  loadCollectionById,
  type StoredCollection,
} from '../../collections/definitions.ts';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import { areaOfRow } from '../../collections/row-area.ts';
import { collectionReply, viewRows } from '../../collections/replies.ts';
import { createRow, setProperty } from '../../collections/rows.ts';
import { viewRow } from '../../collections/view-rows.ts';
import type { CollectionOutcome } from '../../collections/outcome.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal, type VerbInput, type VerbReply } from '../handler.ts';

const hiddenCollection = () => refusal('collection_not_found');

async function storedOf(context: VerbContext, key: string): Promise<StoredCollection | null> {
  await ensureBuiltIns(context.db, context.at);
  return loadCollection(context.db, key);
}

async function collectionArea(context: VerbContext, input: { readonly collection: string }) {
  const stored = await storedOf(context, input.collection);
  if (stored === null) return hiddenCollection();
  return { resource: { kind: 'area' as const, area: stored.definition.jdArea }, found: stored };
}

function requestOf(context: VerbContext) {
  return {
    actor: context.principal,
    traceId: context.traceId,
    at: context.at,
    newId: () => crypto.randomUUID(),
  };
}

function written<N extends 'create_row' | 'set_property'>(
  outcome: CollectionOutcome,
): VerbReply<N> {
  if (outcome.status === 'error') return refusal(outcome.reason);
  return {
    status: 'accepted',
    output: { rowId: outcome.rowId ?? '', version: outcome.version },
  } as VerbReply<N>;
}

export const readCollectionVerb = gatedHandler<'read_collection', StoredCollection>({
  name: 'read_collection',
  hidden: hiddenCollection,
  resource: collectionArea,
  run: async (context, _input, stored) => ({
    status: 'accepted',
    output: await collectionReply(context.db, stored, context.principal, context.at),
  }),
});

async function viewArea(context: VerbContext, input: VerbInput<'read_view'>) {
  await ensureBuiltIns(context.db, context.at);
  const row = await viewRow(context.db, input.viewId);
  const stored = row === null ? null : await loadCollectionById(context.db, row.collectionId);
  if (stored === null) return refusal('view_not_found');
  return { resource: { kind: 'area' as const, area: stored.definition.jdArea }, found: stored };
}

export const readViewVerb = gatedHandler<'read_view', StoredCollection>({
  name: 'read_view',
  hidden: () => refusal('view_not_found'),
  resource: viewArea,
  run: async (context, input, stored) => {
    const read = await viewRows(context.db, stored, context.principal, context.at, input);
    return read.ok ? { status: 'accepted', output: read.value } : refusal(read.reason);
  },
});

export const createRowVerb = gatedHandler({
  name: 'create_row',
  hidden: hiddenCollection,
  resource: async (context, input) => {
    await ensureBuiltIns(context.db, context.at);
    return { resource: { kind: 'area' as const, area: input.jdArea }, found: null };
  },
  run: async (context, input) => {
    const command = { ...input, command: 'create_row' as const, requestId: crypto.randomUUID() };
    return written<'create_row'>(await createRow(context.db, command, requestOf(context)));
  },
});

async function rowArea(context: VerbContext, input: VerbInput<'set_property'>) {
  const stored = await storedOf(context, input.collection);
  const area = stored === null ? null : await areaOfRow(context.db, stored, input.rowId);
  if (area === null) return refusal('row_not_found');
  return { resource: { kind: 'area' as const, area }, found: null };
}

export const setPropertyVerb = gatedHandler({
  name: 'set_property',
  hidden: () => refusal('row_not_found'),
  resource: rowArea,
  run: async (context, input) => {
    const command = { ...input, command: 'set_property' as const, requestId: crypto.randomUUID() };
    return written<'set_property'>(await setProperty(context.db, command, requestOf(context)));
  },
});
