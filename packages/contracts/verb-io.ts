import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { costBasisSchema, evidenceLabelSchema } from './closed-sets.ts';
import { healthReportSchema } from './health.ts';
import { pullRequestRefSchema, stageKeySchema } from './harness.ts';
import { runStepCosts, runStepSchema } from './runs.ts';
import { fullShaSchema } from './ship-rule.ts';
import {
  frontmatterSchema,
  pageSchema,
  pageStatusSchema,
  pageTypeSchema,
  slugSchema,
} from './pages.ts';
import type { VerbName } from './verb-names.ts';

export const submitToGateResultSchema = z.enum(['advanced', 'parked', 'checks_failed']);

const json = z.record(z.string(), z.json());
const limit = z.number().int().min(1).max(50);
const pageSummary = pageSchema.pick({
  id: true,
  type: true,
  jdArea: true,
  slug: true,
  title: true,
  status: true,
});
const lease = z.object({
  leaseExpiresAt: z.iso.datetime().nullable(),
  leaseWarning: z.boolean(),
});

export const recordRunStepReplySchema = lease.extend({
  prompts: z.array(z.string().min(1).max(4000)).max(20),
});

export const verbIo = {
  search_pages: {
    input: z.object({ query: z.string().min(1).max(200), type: pageTypeSchema.nullable(), limit }),
    output: z.object({ pages: z.array(pageSummary) }),
  },
  read_page: {
    input: z.object({ pageId: z.uuid() }),
    output: z.object({ page: pageSchema }),
  },
  write_page: {
    input: z.object({
      pageId: z.uuid(),
      type: pageTypeSchema,
      jdArea: jdAreaSchema,
      slug: slugSchema,
      title: z.string().min(1).max(200),
      parentId: z.uuid().nullable(),
      frontmatter: frontmatterSchema,
      bodyMd: z.string().max(1_000_000),
      expectedVersion: z.number().int().min(1).nullable(),
    }),
    output: z.object({
      pageId: z.uuid(),
      version: z.number().int().min(1),
      status: pageStatusSchema,
    }),
  },
  resolve_context: {
    input: z.object({ itemId: z.uuid() }),
    output: z.object({
      instructions: pageSummary.nullable(),
      package: z.array(pageSummary),
      learnings: z.array(
        z.object({ page: pageSummary, confidence: evidenceLabelSchema, asOf: z.iso.date() }),
      ),
    }),
  },
  query_entities: {
    input: z.object({ query: z.string().regex(/^[a-z][a-z_]*$/), params: json }),
    output: z.object({ rows: z.array(json) }),
  },
  create_task: {
    input: z.object({
      title: z.string().min(1).max(200),
      jdArea: jdAreaSchema,
      pageId: z.uuid().nullable(),
      due: z.iso.date().nullable(),
    }),
    output: z.object({ taskId: z.uuid(), status: z.literal('suggested') }),
  },
  list_gifts: {
    input: z.object({ since: z.iso.date() }),
    output: z.object({ gifts: z.array(json) }),
  },
  create_draft_journal_entry: {
    input: z.object({
      memo: z.string().min(1).max(500),
      lines: z
        .array(
          z.object({
            account: z.string().min(1).max(64),
            amountMinor: z.number().int(),
            currency: z.string().regex(/^[A-Z]{3}$/),
          }),
        )
        .min(2),
    }),
    output: z.object({ entryId: z.uuid() }),
  },
  poll_queue: {
    input: z.object({ harnessId: z.uuid().nullable(), limit }),
    output: z.object({
      items: z.array(
        z.object({
          itemId: z.uuid(),
          harnessId: z.uuid(),
          stage: z.string().min(1),
          title: z.string().min(1),
          priority: z.number().int(),
        }),
      ),
    }),
  },
  claim_item: {
    input: z.object({
      itemId: z.uuid(),
      delegationId: z.uuid().nullable(),
      adoptBranch: z.boolean().default(false),
    }),
    output: lease.extend({
      itemId: z.uuid(),
      branch: z.strictObject({
        name: z.string().regex(/^harness\/[0-9a-f-]{36}$/),
        startFrom: fullShaSchema.nullable(),
        adopted: z.boolean(),
      }),
    }),
  },
  submit_to_gate: {
    input: z
      .strictObject({
        itemId: z.uuid(),
        evidence: json,
        to: stageKeySchema.nullable(),
        pullRequest: pullRequestRefSchema.nullable(),
        head: z
          .string()
          .regex(/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/)
          .nullable(),
      })
      .refine(
        (input) => (input.pullRequest === null) === (input.head === null),
        'a pull request and its head come together',
      ),
    output: z.object({
      itemId: z.uuid(),
      result: submitToGateResultSchema,
      failures: z.array(z.string()),
    }),
  },
  record_run_step: {
    input: z.strictObject({
      itemId: z.uuid(),
      runId: z.uuid(),
      step: runStepSchema,
      tokensIn: z.number().int().min(0),
      tokensOut: z.number().int().min(0),
      costBasis: costBasisSchema,
      ...runStepCosts,
    }),
    output: recordRunStepReplySchema,
  },
  get_health: {
    input: z.object({ harnessId: z.uuid() }),
    output: healthReportSchema,
  },
} as const satisfies Record<VerbName, { input: z.ZodType; output: z.ZodType }>;
