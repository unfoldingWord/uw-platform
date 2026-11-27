import { Hono, type Context } from 'hono';
import {
  expressionFieldsOf,
  storyCommandSchemas,
  storyExpressionCommandSchemas,
  withdrawalReportSchema,
} from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { storiesScreen } from '../views/screens/stories.tsx';
import {
  addStoryExpression,
  confirmStoryExpression,
  retireStoryExpression,
  updateStoryExpression,
  type DecisionOutcome,
  type ExpressionOutcome,
} from './expressions.ts';
import {
  recordStoryConsent,
  setStoryLevel,
  setStoryMediaLevel,
  withdrawStoryConsent,
  type StoryOutcome,
} from './levels.ts';

type Request = {
  readonly c: Context<AppEnv>;
  readonly db: Database;
  readonly actor: Principal;
  readonly body: unknown;
};

type Handler = (request: Request) => Promise<Response | null>;

type Answered = StoryOutcome | DecisionOutcome | ExpressionOutcome;

function answered(c: Context<AppEnv>, requestId: string, outcome: Answered): Response {
  return reply(c, toOutcome(requestId, outcome.ok ? { ok: true } : outcome));
}

const levelCommand: Handler = async ({ c, db, actor, body }) => {
  const parsed = storyCommandSchemas.set_story_level.safeParse(body);
  if (!parsed.success) return null;
  const outcome = await setStoryLevel(db, actor, parsed.data, c.get('now'));
  return answered(c, parsed.data.requestId, outcome);
};

const mediaCommand: Handler = async ({ c, db, actor, body }) => {
  const parsed = storyCommandSchemas.set_story_media_level.safeParse(body);
  if (!parsed.success) return null;
  const outcome = await setStoryMediaLevel(db, actor, parsed.data, c.get('now'));
  return answered(c, parsed.data.requestId, outcome);
};

const consentCommand: Handler = async ({ c, db, actor, body }) => {
  const parsed = storyCommandSchemas.record_story_consent.safeParse(body);
  if (!parsed.success) return null;
  const outcome = await recordStoryConsent(db, actor, parsed.data, c.get('now'));
  return answered(c, parsed.data.requestId, outcome);
};

const withdrawCommand: Handler = async ({ c, db, actor, body }) => {
  const parsed = storyCommandSchemas.withdraw_story_consent.safeParse(body);
  if (!parsed.success) return null;
  const { requestId } = parsed.data;
  const outcome = await withdrawStoryConsent(db, actor, parsed.data, c.get('now'));
  if (!outcome.ok) return answered(c, requestId, outcome);
  c.set('outcome', 'accepted');
  const report = {
    status: 'accepted',
    requestId,
    uses: [...outcome.uses],
    expressions: [...outcome.expressions],
  };
  return c.json(withdrawalReportSchema.parse(report), 200);
};

const addExpression: Handler = async ({ c, db, actor, body }) => {
  const parsed = storyExpressionCommandSchemas.add_story_expression.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, pageId } = parsed.data;
  const adding = { pageId, ...expressionFieldsOf(parsed.data) };
  return answered(c, requestId, await addStoryExpression(db, actor, adding, c.get('now')));
};

const updateExpression: Handler = async ({ c, db, actor, body }) => {
  const parsed = storyExpressionCommandSchemas.update_story_expression.safeParse(body);
  if (!parsed.success) return null;
  const { requestId, expressionId } = parsed.data;
  const editing = { expressionId, ...expressionFieldsOf(parsed.data) };
  return answered(c, requestId, await updateStoryExpression(db, actor, editing, c.get('now')));
};

const confirmExpression: Handler = async ({ c, db, actor, body }) => {
  const parsed = storyExpressionCommandSchemas.confirm_story_expression.safeParse(body);
  if (!parsed.success) return null;
  const outcome = await confirmStoryExpression(db, actor, parsed.data, c.get('now'));
  return answered(c, parsed.data.requestId, outcome);
};

const retireExpression: Handler = async ({ c, db, actor, body }) => {
  const parsed = storyExpressionCommandSchemas.retire_story_expression.safeParse(body);
  if (!parsed.success) return null;
  const outcome = await retireStoryExpression(db, actor, parsed.data, c.get('now'));
  return answered(c, parsed.data.requestId, outcome);
};

const handlers = new Map<string, Handler>([
  ['add_story_expression', addExpression],
  ['update_story_expression', updateExpression],
  ['confirm_story_expression', confirmExpression],
  ['retire_story_expression', retireExpression],
  ['set_story_level', levelCommand],
  ['set_story_media_level', mediaCommand],
  ['record_story_consent', consentCommand],
  ['withdraw_story_consent', withdrawCommand],
]);

async function handleCommand(c: Context<AppEnv>): Promise<Response> {
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const answer = await run({ c, db: database.db, actor, body });
  return answer ?? malformed(c, body);
}

export function storyRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handleCommand);
  return routes;
}

export function storyScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', storiesScreen);
  return routes;
}
