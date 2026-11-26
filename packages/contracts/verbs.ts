import { z } from 'zod';
import { jdAreaSchema, type JdArea } from './areas.ts';
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
  readonly summary: string;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
};

export type VerbManifestEntry = {
  readonly name: VerbName;
  readonly group: VerbGroup;
  readonly grant: VerbGrant | null;
  readonly servedInV1: boolean;
  readonly summary: string;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
};

const onResource = (role: Role): VerbGrant => ({ scope: 'resource_area', role });
const inArea = (role: Role, area: JdArea): VerbGrant => ({ scope: 'fixed_area', role, area });

const ioByName = new Map<string, { input: z.ZodType; output: z.ZodType }>(Object.entries(verbIo));

function verb(
  name: VerbName,
  group: VerbGroup,
  grant: VerbGrant | null,
  summary: string,
  servedInV1 = true,
): VerbDefinition {
  const io = ioByName.get(name);
  if (!io) throw new Error(`no input and output schemas for verb ${name}`);
  return { name, group, grant, servedInV1, summary, input: io.input, output: io.output };
}

const measureVerbs: readonly VerbDefinition[] = [
  verb(
    'save_measure',
    'pages_and_context',
    onResource('editor'),
    'Save a measure from typed fields: a pinned tool and its command, a saved view of resources, a schedule, values and metrics. It lands suggested; a person runs its trial and activates it.',
  ),
  verb(
    'save_dashboard',
    'pages_and_context',
    onResource('editor'),
    "Save a dashboard from typed fields: its context and its panels over a measure's metrics and values. It lands suggested for a person to make active.",
  ),
  verb(
    'run_measure',
    'records',
    onResource('editor'),
    "Ask for a run of an active measure now, at most once an hour, shared with a person's Run now. It cannot start a trial or activate a measure.",
  ),
  verb(
    'read_measure_run',
    'records',
    onResource('viewer'),
    "Read one run of a measure, or its latest, trial included: its state, the hosts it refused and each resource's outcome, values and raw output.",
  ),
  verb(
    'read_metric',
    'records',
    onResource('viewer'),
    "Read one metric of a measure for a context: the figure, each resource's value and the coverage, over the resources you may read.",
  ),
  verb(
    'read_observations',
    'records',
    onResource('viewer'),
    'Read the observations of a measure, newest first, for the resources you may read; a failed observation carries its reason and no value.',
  ),
  verb(
    'preview_dashboard',
    'records',
    onResource('viewer'),
    "Check a dashboard's panels against their measures, drawn from the trial's output where no run has landed, and return every problem.",
  ),
];

export const verbRegistry: readonly VerbDefinition[] = [
  verb(
    'search_pages',
    'pages_and_context',
    null,
    'Search the pages you may read by text, optionally of one page type.',
  ),
  verb('read_page', 'pages_and_context', onResource('viewer'), 'Read one page you may read.'),
  verb(
    'write_page',
    'pages_and_context',
    onResource('editor'),
    'Create a page or save a new version of one; learning, skill and persona pages land as suggested for a person to confirm.',
  ),
  verb(
    'attach_file',
    'pages_and_context',
    onResource('editor'),
    'Attach a picture or file to a page you may edit; embed it in the page body by the url it answers.',
  ),
  verb(
    'render_pdf',
    'pages_and_context',
    onResource('viewer'),
    'Render a page, a saved view or a binder of pages you may read as a PDF; it answers an export a signed-in person can download.',
  ),
  verb(
    'resolve_context',
    'pages_and_context',
    onResource('viewer'),
    "For an item, get its stage's instructions page, its package pages and the confirmed learnings that apply, most specific first.",
  ),
  verb(
    'query_entities',
    'records',
    null,
    'Run one named, whitelisted query with its parameters; rows you could not read directly are never returned.',
  ),
  verb(
    'create_task',
    'records',
    onResource('editor'),
    'Suggest a task in an area, attributed to you, for a person to confirm.',
  ),
  verb(
    'read_collection',
    'records',
    onResource('viewer'),
    "Read a collection's definition: its properties, their types and options, its saved views and row templates.",
  ),
  verb(
    'read_view',
    'records',
    onResource('viewer'),
    'Read the rows of a saved view you may see, filtered, sorted and grouped as the view says; properties you may not read are withheld.',
  ),
  verb(
    'create_row',
    'records',
    onResource('editor'),
    'Create a row in a collection, in an area you may write; money and other read-through properties cannot be set.',
  ),
  verb(
    'set_property',
    'records',
    onResource('editor'),
    'Set one property of a row you may write; read-through, rollup, computed and system properties cannot be set.',
  ),
  verb(
    'list_gifts',
    'role_gated',
    inArea('editor', '40-49'),
    'List gifts since a date, in areas 40 to 49. Not served in v1.',
    false,
  ),
  verb(
    'create_draft_journal_entry',
    'role_gated',
    inArea('editor', '20-29'),
    'Draft a journal entry, in areas 20 to 29. Not served in v1.',
    false,
  ),
  verb(
    'poll_queue',
    'harness',
    null,
    'List the items you may claim now on the harnesses you work.',
  ),
  verb(
    'claim_item',
    'harness',
    onResource('editor'),
    "Claim an item; an agent's claim takes a 15-minute lease. An unattended runner names its delegation.",
  ),
  verb(
    'submit_to_gate',
    'harness',
    onResource('editor'),
    "Submit your work on an item to its stage's exit gate; a human gate parks the item for a person.",
  ),
  verb(
    'record_run_step',
    'harness',
    onResource('editor'),
    'Record one step of your run with its tokens; it renews your lease and warns when the lease is near expiry.',
  ),
  verb(
    'get_health',
    'harness',
    onResource('viewer'),
    'Get the agent-plane health of one harness you may see.',
  ),
  ...measureVerbs,
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
