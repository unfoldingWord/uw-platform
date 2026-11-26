import type { ErrorReason } from '@uw/contracts';
import type { McpHost } from '../mcp/context.ts';

type Call = { readonly verb: string; readonly args: Readonly<Record<string, unknown>> };

const WEBSITES = 'c0110000-0000-4000-8000-000000000701';

const measure = {
  runtime: 'uvx',
  package: 'geo-optimizer-skill==4.19.10',
  command: ['geo', 'audit', '--url', '{address}'],
  resources: { view: WEBSITES },
  schedule: { every: 'day' },
  values: [],
  metrics: [],
  report_card: null,
};

function pageFields(host: McpHost, kind: string, id: string) {
  const slug = `conformance-${kind}-${host}-${id.slice(0, 8)}`;
  return { expectedVersion: null, jdArea: '80-89', title: `A ${kind} from ${host}`, slug };
}

export function measureCalls(host: McpHost): Call[] {
  const measureId = crypto.randomUUID();
  const dashboardId = crypto.randomUUID();
  const panels = [{ kind: 'status', measure: measureId }];
  const context = { kind: 'organization', resource_kind: 'website' };
  return [
    {
      verb: 'save_measure',
      args: { measureId, ...pageFields(host, 'measure', measureId), bodyMd: '', measure },
    },
    {
      verb: 'save_dashboard',
      args: {
        dashboardId,
        ...pageFields(host, 'dashboard', dashboardId),
        intro: '',
        context,
        panels,
      },
    },
    { verb: 'run_measure', args: { measureId } },
    { verb: 'read_measure_run', args: { measureId, runId: null } },
    { verb: 'read_metric', args: { measureId, metric: 'average_score', context } },
    { verb: 'read_observations', args: { measureId } },
    { verb: 'preview_dashboard', args: { dashboardId, hostPageId: null } },
  ];
}

export const measureOutcomes = new Map<string, 'accepted' | ErrorReason>([
  ['save_measure', 'accepted'],
  ['save_dashboard', 'accepted'],
  ['run_measure', 'not_permitted'],
  ['read_measure_run', 'run_not_found'],
  ['read_metric', 'property_not_found'],
  ['read_observations', 'accepted'],
  ['preview_dashboard', 'accepted'],
]);
