import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import {
  dashboardContextSchema,
  metricContextSchema,
  panelKindSchema,
  panelSchema,
} from './dashboards.ts';
import {
  authoringProblemSchema,
  coverageSchema,
  measureAwaitingSchema,
  measureFrontmatterSchema,
  measureRunKindSchema,
  measureRunStateSchema,
  metricRuleSchema,
  observationOutcomeSchema,
  observationReasonSchema,
  observedValueSchema,
  observedValuesSchema,
  REFUSED_HOST_LENGTH,
  REFUSED_HOSTS_SHOWN,
  valueKeySchema,
  valueTypeSchema,
} from './measures.ts';
import { pageStatusSchema, slugSchema } from './pages.ts';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.iso.datetime();
const version = z.number().int().min(1);
const problems = z.array(authoringProblemSchema).max(100);
const title = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, 'a title is not blank');
const pageFields = {
  expectedVersion: version.nullable(),
  jdArea: jdAreaSchema,
  title,
  slug: slugSchema,
};

const outlineLeaf = z.strictObject({
  path: z.string().max(300),
  type: valueTypeSchema.nullable(),
  sample: z.union([z.number(), z.string().max(80), z.boolean(), z.null()]),
});

const runObservation = z.strictObject({
  resourceId: z.uuid(),
  title: z.string().max(200),
  outcome: observationOutcomeSchema,
  reason: observationReasonSchema.nullable(),
  toolVersion: z.string().max(100).nullable(),
  values: observedValuesSchema.nullable(),
  raw: z.string().max(8000).nullable(),
  rawTruncated: z.boolean(),
  rawLength: z.number().int().min(0),
  outline: z.array(outlineLeaf).max(150).nullable(),
  outlineMore: z.boolean(),
  problems: z.array(authoringProblemSchema).max(50),
});

const runReply = z.strictObject({
  runId: z.uuid(),
  measureId: z.uuid(),
  measureVersion: version,
  kind: measureRunKindSchema,
  state: measureRunStateSchema,
  toolHash: sha256,
  lockSha256: sha256.nullable(),
  requestedBy: z.string().min(1).max(300),
  createdAt: instant,
  startedAt: instant.nullable(),
  finishedAt: instant.nullable(),
  refusedHosts: z.array(z.string().max(REFUSED_HOST_LENGTH)).max(REFUSED_HOSTS_SHOWN),
  refusedHostsMore: z.boolean(),
  detailLimited: z.boolean(),
  observations: z.array(runObservation).max(500),
});

const metricResource = z.strictObject({
  resourceId: z.uuid(),
  title: z.string().max(200),
  value: observedValueSchema.nullable(),
  observedAt: instant.nullable(),
  reason: observationReasonSchema.nullable(),
  meetsTarget: z.boolean().nullable(),
  points: z
    .array(
      z.strictObject({
        at: instant,
        value: z.number().finite(),
        toolVersion: z.string().max(100).nullable(),
      }),
    )
    .max(400),
});

const metricReply = z.strictObject({
  measureId: z.uuid(),
  metric: valueKeySchema,
  name: z.string().max(80),
  rule: metricRuleSchema,
  unit: z.string().max(20).nullable(),
  target: z.number().finite().nullable(),
  asOf: instant.nullable(),
  figure: z.number().finite().nullable(),
  resources: z.array(metricResource).max(500),
  coverage: coverageSchema,
});

const observationRow = z.strictObject({
  observationId: z.uuid(),
  runId: z.uuid(),
  runKind: measureRunKindSchema,
  resourceId: z.uuid(),
  measureVersion: version,
  observedAt: instant,
  toolVersion: z.string().max(100).nullable(),
  outcome: observationOutcomeSchema,
  reason: observationReasonSchema.nullable(),
  values: observedValuesSchema.nullable(),
});

export const entityMeasureSchema = z.strictObject({
  measureId: z.uuid(),
  title: z.string().max(200),
  metrics: z
    .array(
      metricReply.pick({
        metric: true,
        name: true,
        rule: true,
        unit: true,
        target: true,
        asOf: true,
        figure: true,
        coverage: true,
      }),
    )
    .max(50),
});

const panelPreview = z.strictObject({
  index: z.number().int().min(0),
  kind: panelKindSchema,
  title: z.string().max(120).nullable(),
  drawn: z.boolean(),
  coverage: coverageSchema.nullable(),
  problems,
});

export const measureVerbIo = {
  save_measure: {
    input: z.strictObject({
      measureId: z.uuid(),
      ...pageFields,
      bodyMd: z.string().max(100_000),
      measure: measureFrontmatterSchema,
    }),
    output: z.strictObject({
      measureId: z.uuid(),
      version,
      status: pageStatusSchema,
      toolHash: sha256,
      awaiting: measureAwaitingSchema,
      problems,
    }),
  },
  save_dashboard: {
    input: z.strictObject({
      dashboardId: z.uuid(),
      ...pageFields,
      intro: z.string().max(20_000),
      context: dashboardContextSchema,
      panels: z.array(panelSchema).min(1).max(24),
    }),
    output: z.strictObject({ dashboardId: z.uuid(), version, status: pageStatusSchema, problems }),
  },
  run_measure: {
    input: z.strictObject({ measureId: z.uuid() }),
    output: z.strictObject({ runId: z.uuid(), measureId: z.uuid(), state: measureRunStateSchema }),
  },
  read_measure_run: {
    input: z.strictObject({
      measureId: z.uuid(),
      runId: z.uuid().nullable(),
      resourceId: z
        .uuid()
        .nullable()
        .default(null)
        .describe(
          'One resource of the run to read in full; without it the first three carry detail',
        ),
    }),
    output: runReply,
  },
  read_metric: {
    input: z.strictObject({
      measureId: z.uuid(),
      metric: valueKeySchema,
      context: metricContextSchema,
    }),
    output: metricReply,
  },
  read_observations: {
    input: z.strictObject({
      measureId: z.uuid(),
      resourceId: z.uuid().nullable().default(null),
      since: instant.nullable().default(null),
      limit: z.number().int().min(1).max(200).default(50),
      cursor: z
        .string()
        .regex(/^[0-9]{1,7}$/)
        .nullable()
        .default(null),
    }),
    output: z.strictObject({
      observations: z.array(observationRow).max(200),
      nextCursor: z
        .string()
        .regex(/^[0-9]{1,7}$/)
        .nullable(),
    }),
  },
  preview_dashboard: {
    input: z.strictObject({ dashboardId: z.uuid(), hostPageId: z.uuid().nullable() }),
    output: z.strictObject({
      dashboardId: z.uuid(),
      panels: z.array(panelPreview).max(24),
      problems,
    }),
  },
} as const;
