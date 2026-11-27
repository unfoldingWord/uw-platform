import { z } from 'zod';
import { RESOURCES_COLLECTION_KEY, WEBSITES_VIEW_ID } from './resource-ids.ts';

export const measureRuntimes = ['uvx'] as const;
export const valueTypes = ['number', 'percent', 'text', 'text_list', 'yes_no'] as const;
export const metricRules = [
  'latest',
  'previous',
  'change',
  'average',
  'minimum',
  'maximum',
  'count_meeting',
  'share_meeting',
  'over_time',
] as const;
export const thresholdOps = ['at_least', 'at_most'] as const;
export const measureRunKinds = ['trial', 'scheduled', 'requested'] as const;
export const measureRunStates = [
  'queued',
  'running',
  'ok',
  'partial',
  'failed',
  'stalled',
  'not_wired',
] as const;
export const observationOutcomes = ['ok', 'failed'] as const;
export const observationReasons = [
  'timed_out',
  'tool_failed',
  'output_not_json',
  'output_unfit',
  'unreachable',
  'host_refused',
] as const;
export const measurePausedReasons = ['changed', 'activator_lost_access', 'retired'] as const;
export const REFUSED_HOSTS_SHOWN = 100;
export const REFUSED_HOST_LENGTH = 253;
export const commandPlaceholders = ['{address}', '{host}'] as const;

export const measureRuntimeSchema = z.enum(measureRuntimes);
export const valueTypeSchema = z.enum(valueTypes);
export const metricRuleSchema = z.enum(metricRules);
export const thresholdOpSchema = z.enum(thresholdOps);
export const measureRunKindSchema = z.enum(measureRunKinds);
export const measureRunStateSchema = z.enum(measureRunStates);
export const observationOutcomeSchema = z.enum(observationOutcomes);
export const observationReasonSchema = z.enum(observationReasons);
export const measurePausedReasonSchema = z.enum(measurePausedReasons);

const numericTypes: ReadonlySet<string> = new Set(['number', 'percent']);
const numericRules: ReadonlySet<string> = new Set([
  'change',
  'average',
  'minimum',
  'maximum',
  'count_meeting',
  'share_meeting',
  'over_time',
]);
const countingRules: ReadonlySet<string> = new Set(['count_meeting', 'share_meeting']);

export const valueKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, 'a key is lowercase snake_case of at most 48 characters');

const name = z
  .string()
  .max(80)
  .refine((value) => value.trim().length > 0, 'a name is not blank');

const pointerEscape = /~(?![01])/;

const jsonPointer = z
  .string()
  .max(300)
  .refine(
    (value) => value === '' || (value.startsWith('/') && !pointerEscape.test(value)),
    'a path is an RFC 6901 JSON pointer such as /score',
  )
  .describe(
    "An RFC 6901 JSON pointer into the tool's JSON output, such as /score or /categories/0/points; ~1 stands for / and ~0 for ~ in a key. read_measure_run lists the pointers a trial's output holds",
  );

const failurePath = z
  .string()
  .max(300)
  .refine(
    (value) => value.startsWith('/') && !pointerEscape.test(value),
    'a failure path is an RFC 6901 JSON pointer below the whole output, such as /error',
  )
  .describe(
    'Optional. An RFC 6901 JSON pointer to where the tool reports a failure while still exiting 0, such as /error for geo audit. When the output holds anything there but null, false or empty text, the observation is failed and its values are not kept',
  );

const packageName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const preRelease = /(?:a|b|rc)[0-9]{1,6}$/;
const releaseSegment = /^[0-9]{1,9}$/;

function exactVersion(version: string): boolean {
  const tail = preRelease.exec(version)?.[0] ?? '';
  const segments = version.slice(0, version.length - tail.length).split('.');
  return segments.length <= 6 && segments.every((segment) => releaseSegment.test(segment));
}

function pinned(spec: string): boolean {
  const [name = '', version = '', ...rest] = spec.split('==');
  return (
    rest.length === 0 &&
    packageName.test(name) &&
    /[A-Za-z0-9]$/.test(name) &&
    exactVersion(version)
  );
}

const packageSpec = z
  .string()
  .max(160)
  .refine(pinned, 'a package is pinned to one exact version, as name==1.2.3')
  .describe(
    'The PyPI package pinned to one exact version, as name==1.2.3, for example geo-optimizer-skill==4.19.10',
  );

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

const placeholder = /\{address\}|\{host\}/g;

const argument = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !hasControlCharacter(value), 'an argument holds no control character')
  .refine(
    (value) => !/[{}]/.test(value.replace(placeholder, '')),
    'only {address} and {host} are filled in',
  );

const toolName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const runners: ReadonlySet<string> = new Set(['uvx', 'uv']);

const commandSchema = z
  .array(argument)
  .min(1)
  .max(40)
  .refine(
    (args) => toolName.test(args[0] ?? '') && !runners.has(args[0] ?? ''),
    'the command starts with the tool the package installs, such as geo, never uvx, uv or an option: the platform installs the package and runs the tool itself',
  )
  .refine(
    (args) => args.some((arg) => commandPlaceholders.some((token) => arg.includes(token))),
    'the command fills in {address} or {host} from each resource',
  )
  .describe(
    'The tool and its arguments, one per item, run without a shell. The first item is the tool the package installs, never uvx or uv. {address} is filled in with the resource address and {host} with its host. The tool prints JSON. Example: ["geo", "audit", "--url", "{address}", "--format", "json"]',
  );

export const measureScheduleSchema = z.discriminatedUnion('every', [
  z.strictObject({ every: z.literal('day') }),
  z.strictObject({ every: z.literal('week'), weekday: z.number().int().min(0).max(6) }),
  z.strictObject({ every: z.literal('month'), day: z.number().int().min(1).max(28) }),
]);

export const thresholdSchema = z.strictObject({
  op: thresholdOpSchema,
  threshold: z.number().finite(),
});

export const measureValueSchema = z.strictObject({
  key: valueKeySchema,
  name,
  type: valueTypeSchema,
  unit: z.string().min(1).max(20).optional(),
  path: jsonPointer,
});

export const metricSchema = z
  .strictObject({
    key: valueKeySchema,
    name,
    value: valueKeySchema,
    rule: metricRuleSchema,
    condition: thresholdSchema.optional(),
    target: z.number().finite().optional(),
  })
  .refine((metric) => countingRules.has(metric.rule) === (metric.condition !== undefined), {
    message: 'count_meeting and share_meeting state a condition, and no other rule does',
    path: ['condition'],
  });

type MeasureValue = z.infer<typeof measureValueSchema>;
type Metric = z.infer<typeof metricSchema>;
type Issues = z.RefinementCtx;

function repeatedKeys(items: readonly { readonly key: string }[], at: string, ctx: Issues): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.key)) {
      ctx.addIssue({ code: 'custom', message: 'each key once', path: [at, index, 'key'] });
    }
    seen.add(item.key);
  });
}

function metricProblem(metric: Metric, values: ReadonlyMap<string, MeasureValue>) {
  const value = values.get(metric.value);
  if (value === undefined) return { field: 'value', message: 'names a value the measure keeps' };
  const numeric = numericTypes.has(value.type);
  if (numericRules.has(metric.rule) && !numeric) {
    return { field: 'rule', message: 'this rule works only over a number or a percent' };
  }
  if (metric.target !== undefined && !numeric) {
    return { field: 'target', message: 'a target is set only on a number or a percent' };
  }
  return null;
}

function checkMetrics(
  measure: { readonly values: readonly MeasureValue[]; readonly metrics: readonly Metric[] },
  ctx: Issues,
): void {
  repeatedKeys(measure.values, 'values', ctx);
  repeatedKeys(measure.metrics, 'metrics', ctx);
  const values = new Map(measure.values.map((value) => [value.key, value]));
  measure.metrics.forEach((metric, index) => {
    const problem = metricProblem(metric, values);
    if (problem === null) return;
    ctx.addIssue({
      code: 'custom',
      message: problem.message,
      path: ['metrics', index, problem.field],
    });
  });
}

export const measureFrontmatterSchema = z
  .strictObject({
    runtime: measureRuntimeSchema,
    package: packageSpec,
    command: commandSchema,
    resources: z.strictObject({
      view: z
        .uuid()
        .describe(
          `A saved view of the Resources collection (collection key ${RESOURCES_COLLECTION_KEY}); its Websites view is ${WEBSITES_VIEW_ID}`,
        ),
    }),
    schedule: measureScheduleSchema,
    values: z.array(measureValueSchema).max(50),
    metrics: z.array(metricSchema).max(50),
    failure_path: failurePath.optional(),
    report_card: z
      .uuid()
      .nullable()
      .describe(
        'A dashboard whose context kind is host, shown on each project, program or portfolio page that a measured resource serves; null for none',
      ),
  })
  .superRefine(checkMetrics);

export const observedValueSchema = z.union([
  z.number().finite(),
  z.string().max(10_000),
  z.boolean(),
  z.array(z.string().max(2000)).max(200),
]);

export const observedValuesSchema = z.record(valueKeySchema, observedValueSchema);

export const coverageSchema = z.strictObject({
  scored: z.number().int().min(0),
  total: z.number().int().min(0),
  failed: z.array(
    z.strictObject({ reason: observationReasonSchema, count: z.number().int().min(1) }),
  ),
});

export const authoringProblemSchema = z.strictObject({
  path: z.string().max(200),
  message: z.string().min(1).max(500),
});

export const measureAwaitingSchema = z.enum(['trial', 'activation', 'nothing']);

export type MeasureRuntime = z.infer<typeof measureRuntimeSchema>;
export type ValueType = z.infer<typeof valueTypeSchema>;
export type MetricRule = z.infer<typeof metricRuleSchema>;
export type MeasureRunKind = z.infer<typeof measureRunKindSchema>;
export type MeasureRunState = z.infer<typeof measureRunStateSchema>;
export type ObservationOutcome = z.infer<typeof observationOutcomeSchema>;
export type ObservationReason = z.infer<typeof observationReasonSchema>;
export type MeasurePausedReason = z.infer<typeof measurePausedReasonSchema>;
export type MeasureSchedule = z.infer<typeof measureScheduleSchema>;
export type MeasureValueDefinition = MeasureValue;
export type MetricDefinition = Metric;
export type MeasureFrontmatter = z.infer<typeof measureFrontmatterSchema>;
export type ObservedValue = z.infer<typeof observedValueSchema>;
export type ObservedValues = z.infer<typeof observedValuesSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type AuthoringProblem = z.infer<typeof authoringProblemSchema>;
export type MeasureAwaiting = z.infer<typeof measureAwaitingSchema>;
