import { z } from 'zod';
import { repositorySchema as repositoryName } from '@uw/contracts';

const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().positive().max(2_147_483_647);
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const openOrClosed = z.enum(['open', 'closed']);

export const repositorySchema = z.object({
  id: githubId,
  full_name: repositoryName,
  default_branch: z.string().min(1),
  private: z.boolean(),
});

export const milestoneSchema = z.object({
  id: githubId,
  number: count,
  title: z.string(),
  state: openOrClosed,
  due_on: instant.nullable().optional(),
  updated_at: instant,
});

const labelSchema = z.object({ name: z.string() });

export const issueSchema = z.object({
  id: githubId,
  number: count,
  title: z.string(),
  state: openOrClosed,
  labels: z.array(labelSchema),
  milestone: milestoneSchema.nullable().optional(),
  updated_at: instant,
  pull_request: z.object({}).optional(),
});

export const pullSchema = z.object({
  id: githubId,
  number: count,
  title: z.string(),
  state: openOrClosed,
  draft: z.boolean().optional(),
  merged: z.boolean().nullable().optional(),
  merged_at: z.string().nullable().optional(),
  head: z.object({ sha: z.string(), ref: z.string().min(1) }),
  base: z.object({ ref: z.string().min(1) }),
  body: z.string().nullable().optional(),
  milestone: milestoneSchema.nullable().optional(),
  updated_at: instant,
});

export const reviewSchema = z.object({
  id: githubId,
  user: z.object({ login: z.string() }).nullable(),
  commit_id: z.string().nullable(),
  state: z.string(),
  body: z.string().nullable().optional(),
  submitted_at: instant.nullable().optional(),
});

export const checkRunSchema = z.object({
  id: githubId,
  head_sha: z.string(),
  name: z.string().min(1),
  status: z.string(),
  conclusion: z.string().nullable(),
  started_at: instant.nullable().optional(),
  completed_at: instant.nullable().optional(),
  app: z.object({ slug: z.string() }).nullable().optional(),
});

export const fileSchema = z.object({
  filename: z.string().min(1),
  previous_filename: z.string().min(1).optional(),
});

const withRepository = { action: z.string().optional(), repository: repositorySchema };

export const issuesEventSchema = z.object({ ...withRepository, issue: issueSchema });
export const pullRequestEventSchema = z.object({ ...withRepository, pull_request: pullSchema });
export const reviewEventSchema = z.object({
  ...withRepository,
  pull_request: pullSchema,
  review: reviewSchema,
});
export const checkRunEventSchema = z.object({ ...withRepository, check_run: checkRunSchema });
export const pushEventSchema = z.object(withRepository);
