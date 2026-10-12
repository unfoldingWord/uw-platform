import { pageArea } from '../../pages/reads.ts';
import type { VerbContext } from '../context.ts';
import { refusal, type Found, type VerbRefusal } from '../handler.ts';

type PageInput = { readonly pageId: string };

export function hiddenPage(input: PageInput): VerbRefusal {
  return refusal('page_not_found', { pageId: input.pageId });
}

export async function storedPageArea(
  context: VerbContext,
  input: PageInput,
): Promise<Found<null> | VerbRefusal> {
  const area = await pageArea(context.db, input.pageId);
  if (area === null) return hiddenPage(input);
  return { resource: { kind: 'area', area }, found: null };
}
