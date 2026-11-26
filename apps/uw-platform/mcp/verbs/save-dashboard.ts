import { saveDashboard } from '../../measures/authoring.ts';
import { gatedHandler, refusal, type VerbInput } from '../handler.ts';
import { hiddenPage } from './page-scene.ts';
import { hiddenSave, saveArea } from './save-measure.ts';

export const saveDashboardVerb = gatedHandler({
  name: 'save_dashboard',
  hidden: (input: VerbInput<'save_dashboard'>) => hiddenSave(input.dashboardId)(input),
  resource: (context, input) => saveArea(context, input, input.dashboardId),
  run: async (context, input) => {
    const { db, principal, traceId, at } = context;
    const saved = await saveDashboard({ db, actor: principal, traceId, at }, input);
    if (saved.ok)
      return {
        status: 'accepted',
        output: { ...saved.value, problems: [...saved.value.problems] },
      };
    if (saved.reason === 'page_not_found') return hiddenPage({ pageId: input.dashboardId });
    return refusal(saved.reason, saved.detail);
  },
});
