import type { ErrorReason } from '@uw/contracts';
import type { McpHost } from '../mcp/context.ts';
import { measureCalls, measureOutcomes } from './conformance-measures.ts';

export function readerGrant(personId: string) {
  return {
    id: '00000000-0000-4000-8000-0000000c0011',
    personId,
    role: 'viewer' as const,
    scopeKind: 'jd_area' as const,
    scopeArea: '00-09',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  };
}
const ALL_TASKS = 'c0110000-0000-4000-8000-000000000103';

type Call = { readonly verb: string; readonly args: Readonly<Record<string, unknown>> };

export function collectionCalls(host: McpHost, harnessId: string): Call[] {
  const rowId = crypto.randomUUID();
  const row = { collection: 'tasks', rowId, jdArea: '80-89', values: {}, template: null };
  return [
    { verb: 'read_collection', args: { collection: 'tasks' } },
    { verb: 'read_view', args: { viewId: ALL_TASKS, limit: 10, cursor: null } },
    { verb: 'create_row', args: { ...row, title: `row from ${host}` } },
    {
      verb: 'set_property',
      args: { collection: 'tasks', rowId, property: 'priority', value: 'high' },
    },
    ...measureCalls(host),
    { verb: 'render_chart', args: { chart: 'cumulative_flow', params: { harnessId }, spec: null } },
  ];
}

const collectionOutcomes = new Map<string, 'accepted'>([
  ['render_chart', 'accepted'],
  ['read_collection', 'accepted'],
  ['read_view', 'accepted'],
  ['create_row', 'accepted'],
  ['set_property', 'accepted'],
]);

const delegatedOutcomes = new Map<string, ErrorReason>([
  ['read_collection', 'collection_not_found'],
  ['read_view', 'view_not_found'],
  ['create_row', 'collection_not_found'],
  ['set_property', 'row_not_found'],
]);

export function expectedOn(
  expected: ReadonlyMap<string, 'accepted' | ErrorReason>,
  host: McpHost,
  verb: string,
): 'accepted' | ErrorReason {
  const delegated = host === 'workflow' ? delegatedOutcomes.get(verb) : undefined;
  const known = expected.get(verb) ?? collectionOutcomes.get(verb) ?? measureOutcomes.get(verb);
  return delegated ?? known ?? 'internal_error';
}
