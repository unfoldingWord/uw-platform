import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { capabilityWordSchema, riskTierSchema } from './closed-sets.ts';
import {
  externalReviewerIdentitiesSchema,
  personaIdentitySchema,
  protectedPathsSchema,
  pullRequestRefSchema,
  repositorySchema,
  stageKeySchema,
  stageSchema,
} from './harness.ts';
import { slugSchema } from './pages.ts';
import { dataSourceKindSchema } from './page-types.ts';
import { fullShaSchema, requiredChecksSchema } from './ship-rule.ts';

export const commandNames = [
  'kickstart',
  'enqueue',
  'import',
  'reorder',
  'claim',
  'release',
  'submit_to_gate',
  'approve',
  'reject',
  'take_over',
  'override',
  'prompt_run',
  'stop_run',
  'pause',
  'resume',
  'tweak_package',
  'schedule_regular_tweak',
  'revoke_delegation',
  'recover_connectors',
  'activate_template',
  'create_stage',
  'update_stage',
  'reorder_stages',
  'remove_stage',
  'set_hosted_builder',
  'activate_persona',
  'record_measurement',
  'set_shadow',
  'set_freeze',
  'decide_gates',
  'refute_finding',
] as const;

export const commandNameSchema = z.enum(commandNames);
export type CommandName = z.infer<typeof commandNameSchema>;

export const templateKeySchema = z.enum(['software', 'bml', 'check-only']);
export type TemplateKey = z.infer<typeof templateKeySchema>;

const requestId = z.uuid();
const itemId = z.uuid();
const nonBlank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, 'not blank');

const body = <Name extends CommandName, Shape extends z.ZodRawShape>(name: Name, shape: Shape) =>
  z.strictObject({ command: z.literal(name), requestId, ...shape });

const stageBounds = {
  wipLimit: z.number().int().min(1).max(1000),
  validators: stageSchema.shape.validators.pipe(z.array(z.string().max(100)).max(50)),
  feeds: stageSchema.shape.feeds.pipe(z.array(stageKeySchema).max(50)),
};

const stageInputSchema = stageSchema
  .omit({ id: true, harnessId: true, paused: true })
  .extend(stageBounds);
const stageChangeSchema = stageSchema
  .omit({ id: true, harnessId: true, key: true, paused: true })
  .extend(stageBounds)
  .partial()
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'a change names at least one column');

const submitCommandSchema = body('submit_to_gate', {
  itemId,
  to: stageKeySchema.nullable(),
  pullRequest: pullRequestRefSchema.nullable(),
  head: fullShaSchema.nullable(),
}).refine(
  (command) => (command.pullRequest === null) === (command.head === null),
  'a pull request and its head come together',
);

export const overrideCommandSchema = body('override', {
  itemId,
  head: fullShaSchema.nullable(),
  reason: nonBlank(2000),
});

const itemIdList = z
  .array(itemId)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'each item once');

const batchEntrySchema = z.strictObject({
  itemId,
  head: fullShaSchema,
  decision: z.enum(['approve', 'reject']),
});

const setFreezeSchema = body('set_freeze', { frozen: z.boolean(), allow: itemIdList }).refine(
  (command) => command.frozen || command.allow.length === 0,
  'lifting a freeze names no item',
);

export const harnessCommandSchemas = {
  kickstart: body('kickstart', { pageId: z.uuid() }),
  enqueue: body('enqueue', {
    title: nonBlank(200),
    pageId: z.uuid().nullable(),
    due: z.iso.date().nullable(),
  }),
  import: body('import', { repository: repositorySchema, number: z.number().int().min(1) }),
  reorder: body('reorder', { itemId, beforeItemId: z.uuid().nullable() }),
  claim: body('claim', { itemId }),
  release: body('release', { itemId }),
  submit_to_gate: submitCommandSchema,
  approve: body('approve', { itemId, head: fullShaSchema.nullable() }),
  reject: body('reject', { itemId, findings: z.array(nonBlank(500)).max(50) }),
  take_over: body('take_over', { itemId }),
  override: overrideCommandSchema,
  prompt_run: body('prompt_run', { itemId, message: nonBlank(4000) }),
  stop_run: body('stop_run', { itemId }),
  pause: body('pause', { stageKey: stageKeySchema.nullable() }),
  resume: body('resume', { stageKey: stageKeySchema.nullable() }),
  tweak_package: body('tweak_package', { itemId }),
  schedule_regular_tweak: body('schedule_regular_tweak', {
    persona: personaIdentitySchema,
    capability: capabilityWordSchema,
    expiresAt: z.iso.datetime().nullable(),
    supersedes: z.uuid().nullable(),
    maxTier: riskTierSchema.nullable().default(null),
  }),
  revoke_delegation: body('revoke_delegation', { delegationId: z.uuid() }),
  recover_connectors: body('recover_connectors', {}),
  activate_template: body('activate_template', {
    harnessKey: slugSchema,
    jdArea: jdAreaSchema,
    template: templateKeySchema,
    repository: repositorySchema.nullable(),
    shadow: z.boolean().default(false),
    externalReviewerIdentities: externalReviewerIdentitiesSchema.default([]),
    requiredChecks: requiredChecksSchema.default([]),
    protectedPaths: protectedPathsSchema.default([]),
  }),
  create_stage: body('create_stage', { stage: stageInputSchema }),
  update_stage: body('update_stage', { stageKey: stageKeySchema, change: stageChangeSchema }),
  reorder_stages: body('reorder_stages', { order: z.array(stageKeySchema).min(1).max(50) }),
  remove_stage: body('remove_stage', { stageKey: stageKeySchema }),
  set_hosted_builder: body('set_hosted_builder', { enabled: z.boolean() }),
  activate_persona: body('activate_persona', {
    pageId: z.uuid(),
    expectedVersion: z.number().int().min(1),
  }),
  record_measurement: body('record_measurement', {
    itemId,
    source: dataSourceKindSchema,
    name: nonBlank(100),
    value: z.number().finite(),
    asOf: z.iso.date(),
  }),
  set_shadow: body('set_shadow', { shadow: z.literal(false) }),
  set_freeze: setFreezeSchema,
  decide_gates: body('decide_gates', {
    entries: z
      .array(batchEntrySchema)
      .min(1)
      .max(50)
      .refine(
        (entries) => new Set(entries.map((entry) => entry.itemId)).size === entries.length,
        'each item once',
      ),
  }),
  refute_finding: body('refute_finding', {
    itemId,
    runId: z.uuid(),
    finding: z.number().int().min(0).max(49),
  }),
} as const satisfies Record<CommandName, z.ZodType>;

export const commandSchema = z.discriminatedUnion('command', [
  harnessCommandSchemas.kickstart,
  harnessCommandSchemas.enqueue,
  harnessCommandSchemas.import,
  harnessCommandSchemas.reorder,
  harnessCommandSchemas.claim,
  harnessCommandSchemas.release,
  harnessCommandSchemas.submit_to_gate,
  harnessCommandSchemas.approve,
  harnessCommandSchemas.reject,
  harnessCommandSchemas.take_over,
  harnessCommandSchemas.override,
  harnessCommandSchemas.prompt_run,
  harnessCommandSchemas.stop_run,
  harnessCommandSchemas.pause,
  harnessCommandSchemas.resume,
  harnessCommandSchemas.tweak_package,
  harnessCommandSchemas.schedule_regular_tweak,
  harnessCommandSchemas.revoke_delegation,
  harnessCommandSchemas.recover_connectors,
  harnessCommandSchemas.activate_template,
  harnessCommandSchemas.create_stage,
  harnessCommandSchemas.update_stage,
  harnessCommandSchemas.reorder_stages,
  harnessCommandSchemas.remove_stage,
  harnessCommandSchemas.set_hosted_builder,
  harnessCommandSchemas.activate_persona,
  harnessCommandSchemas.record_measurement,
  harnessCommandSchemas.set_shadow,
  harnessCommandSchemas.set_freeze,
  harnessCommandSchemas.decide_gates,
  harnessCommandSchemas.refute_finding,
]);

export type Command = z.infer<typeof commandSchema>;
export type CommandBody<Name extends CommandName> = z.infer<(typeof harnessCommandSchemas)[Name]>;
export type OverrideCommand = z.infer<typeof overrideCommandSchema>;
