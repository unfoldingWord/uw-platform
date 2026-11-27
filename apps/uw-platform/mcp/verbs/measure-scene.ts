import { measureArea } from '../../measures/measure-pages.ts';
import type { VerbContext } from '../context.ts';
import { refusal, type Found, type VerbRefusal } from '../handler.ts';

type MeasureInput = { readonly measureId: string };

export function hiddenMeasure(input: MeasureInput): VerbRefusal {
  return refusal('page_not_found', { pageId: input.measureId });
}

export async function storedMeasureArea(
  context: VerbContext,
  input: MeasureInput,
): Promise<Found<null> | VerbRefusal> {
  const area = await measureArea(context.db, input.measureId);
  if (area === null) return hiddenMeasure(input);
  return { resource: { kind: 'area', area }, found: null };
}
