import { Hono, type Context } from 'hono';
import { storyCommandSchemas, withdrawalReportSchema } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { storiesScreen } from '../views/screens/stories.tsx';
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

function answered(c: Context<AppEnv>, requestId: string, outcome: StoryOutcome): Response {
  return reply(c, toOutcome(requestId, outcome));
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
  const report = { status: 'accepted', requestId, uses: [...outcome.uses] };
  return c.json(withdrawalReportSchema.parse(report), 200);
};

const handlers = new Map<string, Handler>([
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
