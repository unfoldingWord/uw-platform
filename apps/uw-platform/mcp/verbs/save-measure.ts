import { saveMeasure } from '../../measures/authoring.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal, type VerbInput, type VerbRefusal } from '../handler.ts';
import { hiddenPage, storedPageArea } from './page-scene.ts';

type SaveInput = { readonly expectedVersion: number | null; readonly jdArea: string };

export function hiddenSave(pageId: string) {
  return (input: SaveInput): VerbRefusal =>
    input.expectedVersion === null ? refusal('not_permitted') : hiddenPage({ pageId });
}

export async function saveArea(context: VerbContext, input: SaveInput, pageId: string) {
  if (input.expectedVersion !== null) return storedPageArea(context, { pageId });
  return { resource: { kind: 'area' as const, area: input.jdArea }, found: null };
}

function requestOf(context: VerbContext) {
  const { db, principal, traceId, at } = context;
  return { db, actor: principal, traceId, at, files: context.files ?? null };
}

export const saveMeasureVerb = gatedHandler({
  name: 'save_measure',
  hidden: (input: VerbInput<'save_measure'>) => hiddenSave(input.measureId)(input),
  resource: (context, input) => saveArea(context, input, input.measureId),
  run: async (context, input) => {
    const saved = await saveMeasure(requestOf(context), input);
    if (saved.ok)
      return {
        status: 'accepted',
        output: { ...saved.value, problems: [...saved.value.problems] },
      };
    if (saved.reason === 'page_not_found') return hiddenPage({ pageId: input.measureId });
    return refusal(saved.reason, saved.detail);
  },
});
