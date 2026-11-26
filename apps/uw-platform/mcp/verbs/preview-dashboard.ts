import { dashboardPageOf } from '../../measures/measure-pages.ts';
import { previewDashboard, readableDashboard } from '../../measures/previews.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal, type Found, type VerbRefusal } from '../handler.ts';

type DashboardInput = { readonly dashboardId: string };

function hiddenDashboard(input: DashboardInput): VerbRefusal {
  return refusal('page_not_found', { pageId: input.dashboardId });
}

async function storedDashboardArea(
  context: VerbContext,
  input: DashboardInput,
): Promise<Found<null> | VerbRefusal> {
  const found = await dashboardPageOf(context.db, input.dashboardId);
  if (found === null) return hiddenDashboard(input);
  return { resource: { kind: 'area', area: found.jdArea }, found: null };
}

export const previewDashboardVerb = gatedHandler({
  name: 'preview_dashboard',
  hidden: hiddenDashboard,
  resource: storedDashboardArea,
  run: async (context, input) => {
    const reader = { db: context.db, actor: context.principal, at: context.at };
    const dashboard = await readableDashboard(reader, input.dashboardId);
    if (dashboard === null) return hiddenDashboard(input);
    const checker = { ...reader, files: context.files ?? null };
    const output = await previewDashboard(checker, dashboard, input.hostPageId);
    return { status: 'accepted', output };
  },
});
