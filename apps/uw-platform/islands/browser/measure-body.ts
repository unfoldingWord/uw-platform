import {
  activateDashboardCommandSchema,
  activateMeasureCommandSchema,
  measureRunCommandSchema,
} from '@uw/contracts';
import type { ZodType } from 'zod';

type Given = ReadonlyMap<string, string>;
type Shape = (given: Given) => Readonly<Record<string, unknown>>;

function versionOf(raw: string | undefined): number | null {
  return raw === undefined || raw === '' ? null : Number(raw);
}

const measureRun: Shape = (given) => ({
  measureId: given.get('measureId'),
  expectedVersion: versionOf(given.get('expectedVersion')),
});

const DASHBOARD = 'dashboard.';

const ticked = (given: Given): string[] =>
  [...given].flatMap(([name, value]) => (name.startsWith(DASHBOARD) ? [value] : []));

export const measureSchemas: ReadonlyMap<string, ZodType> = new Map<string, ZodType>([
  ['run_measure_trial', measureRunCommandSchema],
  ['run_measure_now', measureRunCommandSchema],
  ['activate_measure', activateMeasureCommandSchema],
  ['activate_dashboard', activateDashboardCommandSchema],
]);

export const measureShapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  ['run_measure_trial', measureRun],
  ['run_measure_now', measureRun],
  ['activate_measure', (given) => ({ ...measureRun(given), dashboards: ticked(given) })],
  [
    'activate_dashboard',
    (given) => ({
      dashboardId: given.get('dashboardId'),
      expectedVersion: versionOf(given.get('expectedVersion')),
    }),
  ],
]);
