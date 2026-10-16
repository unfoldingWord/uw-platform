import { z } from 'zod';
import { repositorySchema as repositoryName } from '@uw/contracts';

const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().positive().max(2_147_483_647);
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const openOrClosed = z.enum(['open', 'closed']);
const text = z.string().refine((value) => !value.includes('\u0000'));
const name = text.pipe(z.string().min(1));

export const repositorySchema = z.object({
  id: githubId,
  full_name: repositoryName,
  default_branch: name,
  private: z.boolean(),
});

export const milestoneSchema = z.object({
  id: githubId,
  number: count,
  title: text,
  state: openOrClosed,
  due_on: instant.nullable().optional(),
  updated_at: instant,
});

const labelSchema = z.object({ name: text });

export const issueSchema = z.object({
  id: githubId,
  number: count,
  title: text,
  state: openOrClosed,
  labels: z.array(labelSchema),
  milestone: milestoneSchema.nullable().optional(),
  updated_at: instant,
  pull_request: z.object({}).optional(),
});

export const pullSchema = z.object({
  id: githubId,
  number: count,
  title: text,
  state: openOrClosed,
  draft: z.boolean().optional(),
  merged: z.boolean().nullable().optional(),
  merged_at: z.string().nullable().optional(),
  head: z.object({
    sha: z.string(),
    ref: name,
    repo: z.object({ full_name: z.string() }).nullable().optional(),
  }),
  base: z.object({ sha: z.string(), ref: name }),
  body: z.string().nullable().optional(),
  milestone: milestoneSchema.nullable().optional(),
  requested_reviewers: z.array(z.object({ login: name })).optional(),
  updated_at: instant,
});

export const reviewSchema = z.object({
  id: githubId,
  user: z.object({ login: name }).nullable(),
  commit_id: z.string().nullable(),
  state: z.string(),
  body: z.string().nullable().optional(),
  submitted_at: instant.nullable().optional(),
});

export const checkRunSchema = z.object({
  id: githubId,
  head_sha: z.string(),
  name,
  status: z.string(),
  conclusion: z.string().nullable(),
  started_at: instant.nullable().optional(),
  completed_at: instant.nullable().optional(),
  app: z.object({ slug: name }).nullable().optional(),
});

export const fileSchema = z.object({
  filename: name,
  previous_filename: name.optional(),
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
