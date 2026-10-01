import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { roleSchema, type Role } from './closed-sets.ts';
import { verbIo } from './verb-io.ts';
import type { VerbName } from './verb-names.ts';

export const verbGroupSchema = z.enum(['pages_and_context', 'records', 'role_gated', 'harness']);

export const verbGrantSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('resource_area'), role: roleSchema }),
  z.object({ scope: z.literal('fixed_area'), role: roleSchema, area: jdAreaSchema }),
]);

export type VerbGroup = z.infer<typeof verbGroupSchema>;
export type VerbGrant = z.infer<typeof verbGrantSchema>;

export type VerbDefinition = {
  readonly name: VerbName;
  readonly group: VerbGroup;
  readonly grant: VerbGrant | null;
  readonly servedInV1: boolean;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
};

export type VerbManifestEntry = {
  readonly name: VerbName;
  readonly group: VerbGroup;
  readonly grant: VerbGrant | null;
  readonly servedInV1: boolean;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
};

const onResource = (role: Role): VerbGrant => ({ scope: 'resource_area', role });
const inArea = (role: Role, area: string): VerbGrant => ({ scope: 'fixed_area', role, area });

const ioByName = new Map<string, { input: z.ZodType; output: z.ZodType }>(Object.entries(verbIo));

function verb(
  name: VerbName,
  group: VerbGroup,
  grant: VerbGrant | null,
  servedInV1 = true,
): VerbDefinition {
  const io = ioByName.get(name);
  if (!io) throw new Error(`no input and output schemas for verb ${name}`);
  return { name, group, grant, servedInV1, input: io.input, output: io.output };
}

export const verbRegistry: readonly VerbDefinition[] = [
  verb('search_pages', 'pages_and_context', null),
  verb('read_page', 'pages_and_context', onResource('viewer')),
  verb('write_page', 'pages_and_context', onResource('editor')),
  verb('resolve_context', 'pages_and_context', onResource('viewer')),
  verb('query_entities', 'records', null),
  verb('create_task', 'records', onResource('editor')),
  verb('list_gifts', 'role_gated', inArea('editor', '40-49'), false),
  verb('create_draft_journal_entry', 'role_gated', inArea('editor', '20-29'), false),
  verb('poll_queue', 'harness', null),
  verb('claim_item', 'harness', onResource('editor')),
  verb('submit_to_gate', 'harness', onResource('editor')),
  verb('record_run_step', 'harness', onResource('editor')),
  verb('get_health', 'harness', onResource('viewer')),
];

const byName = new Map<string, VerbDefinition>(verbRegistry.map((entry) => [entry.name, entry]));

export function findVerb(name: string): VerbDefinition | undefined {
  return byName.get(name);
}

export function verbManifest(): VerbManifestEntry[] {
  return verbRegistry.map(({ input, output, ...entry }) => ({
    ...entry,
    input: z.toJSONSchema(input),
    output: z.toJSONSchema(output),
  }));
}
