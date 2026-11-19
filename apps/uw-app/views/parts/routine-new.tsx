import type { Context } from 'hono';
import { z } from 'zod';
import { deviceSegmentSchema, personaSlugOf, routineChangeCommandSchema } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { AgentsView } from '@uw/harness';
import { Card } from '@uw/ui/components/card.tsx';
import { primaryButton } from '@uw/ui/components/command-form.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import {
  accessTokensConfigOf,
  AccessTokenError,
  createAccessServiceToken,
  deleteAccessServiceToken,
  durationUntil,
  type AccessTokensConfig,
  type MadeAccessToken,
} from '../../agents/access-tokens.ts';
import {
  applyRoutineChange,
  type RoutineChangeName,
  type RoutineChangeOutcome,
} from '../../agents/routine-actions.ts';
import { bindOwnRoutine, checkRoutineGrant, type RoutineGrant } from '../../agents/routines.ts';
import type { AppEnv } from '../../deps.ts';
import { notFound } from '../screens/not-found.tsx';
import { capabilityWord } from './agent-words.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from './frame.tsx';
import { moduleCodes, pageNames } from './names.ts';
import { idParam } from './params.ts';
import { agentsPath, queuePath } from './paths.ts';
import { ROUTINE_NAME_LIMIT } from './routines.tsx';
import { workflowCrumbs } from './workflow-tabs.ts';

const postedSchema = z.object({
  delegationId: z.uuid(),
  name: z.string().trim().min(1).max(ROUTINE_NAME_LIMIT),
  device: deviceSegmentSchema,
});

type Posted = z.infer<typeof postedSchema>;

type Made = {
  readonly view: AgentsView;
  readonly posted: Posted;
  readonly grant: RoutineGrant;
  readonly token: MadeAccessToken;
};

function backTo(harnessId: string, notice: string): string {
  return `${agentsPath(harnessId)}?routine=${encodeURIComponent(notice)}`;
}

async function makeToken(
  config: AccessTokensConfig,
  posted: Posted,
  grant: RoutineGrant,
  at: Date,
): Promise<MadeAccessToken | undefined> {
  const name = `uw routine ${posted.device}`;
  try {
    return await createAccessServiceToken(config, name, durationUntil(at, grant.expiresAt));
  } catch (error) {
    if (error instanceof AccessTokenError) return undefined;
    throw error;
  }
}

const platformFetch: typeof fetch = (input, init) => fetch(input, init);

async function setUp(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  view: AgentsView,
): Promise<Made | string> {
  const database = c.get('database');
  if (database === null) return 'database_not_configured';
  const config = accessTokensConfigOf(c.env, platformFetch);
  if (config === null) return 'not_switched_on';
  const parsed = postedSchema.safeParse(await c.req.parseBody());
  if (!parsed.success) return 'malformed_command';
  const posted = parsed.data;
  const { actor } = screen.caller;
  const harnessId = view.harness.id;
  const checked = await checkRoutineGrant(
    database.db,
    actor,
    harnessId,
    posted.delegationId,
    screen.at,
  );
  if (!checked.ok) return checked.reason;
  const login = await makeToken(config, posted, checked.grant, screen.at);
  if (login === undefined) return 'cloudflare_failed';
  const setup = {
    ...posted,
    harnessId,
    routineId: crypto.randomUUID(),
    accessTokenId: login.id,
    clientId: login.clientId,
  };
  const traceId = screen.caller.traceId;
  const bound = await bindOwnRoutine(database.db, actor, setup, traceId, screen.at);
  if (!bound.ok) {
    await deleteAccessServiceToken(config, login.id).catch(() => false);
    return bound.reason;
  }
  return { view, posted, grant: bound.grant, token: login };
}

function Copyable(props: { readonly label: string; readonly text: string }) {
  return (
    <div class="flex flex-col gap-1">
      <p class="m-0 text-xs font-heavy tracking-wide text-text-3 uppercase">{props.label}</p>
      <pre class="m-0 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm whitespace-pre-wrap break-all text-text">
        {props.text}
      </pre>
    </div>
  );
}

function setupLines(made: Made, mcpUrl: string) {
  const persona = personaSlugOf(made.grant.persona) ?? made.grant.persona;
  const headers = [
    `CF-Access-Client-Id: ${made.token.clientId}`,
    `CF-Access-Client-Secret: ${made.token.clientSecret}`,
    `x-uw-device: ${made.posted.device}`,
    `x-uw-persona: ${persona}`,
    `x-uw-delegation: ${made.grant.delegationId}`,
  ];
  const command = [
    `claude mcp add --transport http uw-${made.posted.device} ${mcpUrl}`,
    ...headers.map((header) => `  --header "${header}"`),
  ].join(' \\\n');
  const prompt = [
    `You are the routine "${made.posted.name}", acting as ${persona} on the ${made.view.harness.title} workflow.`,
    `Use the uw-${made.posted.device} tools: poll the queue, claim one item, do its ${capabilityWord(made.grant.capability)} work, record each step, and submit it to its gate.`,
    'If nothing is waiting, stop. If a call is refused, stop and report why.',
  ].join('\n');
  return { headers: headers.join('\n'), command, prompt };
}

function OneTimePage(props: { readonly made: Made; readonly mcpUrl: string }) {
  const { made } = props;
  const lines = setupLines(made, props.mcpUrl);
  return (
    <div class="flex flex-col gap-5">
      <Note>
        This secret is shown once. Copy it now: it is not kept anywhere and cannot be shown again.
      </Note>
      <Card
        title="Connect your Claude Code"
        sub={`Works under your standing permission until ${formatDate(made.grant.expiresAt)}`}
      >
        <div class="flex flex-col gap-4">
          <Copyable label="Run this once on the device" text={lines.command} />
          <Copyable label="Starter prompt" text={lines.prompt} />
          <Copyable label="Address" text={props.mcpUrl} />
          <Copyable label="Headers, for Codex or another client" text={lines.headers} />
          <p class="m-0 text-sm text-text-3">
            To run it on a timer, schedule the prompt on that device, for example hourly with cron
            and claude -p.
          </p>
          <div>
            <a href={agentsPath(made.view.harness.id)} class={primaryButton}>
              Done, back to agents
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}

export async function newRoutine(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  if (harnessId === null) return notFound(c);
  const outcome = await screen.kernel.views.agents(screen.caller, { harnessId }, { at: screen.at });
  if (outcome.status !== 'accepted') return notFound(c);
  const view = outcome.value;
  const made = await setUp(c, screen, view);
  if (typeof made === 'string') return c.redirect(backTo(harnessId, made), 303);
  const spec = {
    title: `${view.harness.title} ${pageNames.agents}`,
    current: agentsPath(harnessId),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(view.harness.title, queuePath(harnessId), pageNames.agents),
  };
  const mcpUrl = `${new URL(c.req.url).origin}/mcp`;
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow="Routine set up"
        title={made.posted.name}
        lede={`On ${made.posted.device}. Paste these into the device's Claude Code.`}
      />
      <OneTimePage made={made} mcpUrl={mcpUrl} />
    </>,
  );
}

const changeSchema = routineChangeCommandSchema.shape.command;

function noticeOf(change: RoutineChangeName, outcome: RoutineChangeOutcome): string {
  if (!outcome.ok) return outcome.reason;
  if (change !== 'revoke_routine') return change;
  return outcome.loginRemoved ? 'revoked' : 'revoked_login_kept';
}

export async function changeRoutineForm(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  const routineId = idParam(c.req.param('routineId'));
  if (harnessId === null || routineId === null) return notFound(c);
  const outcome = await screen.kernel.views.agents(screen.caller, { harnessId }, { at: screen.at });
  if (outcome.status !== 'accepted') return notFound(c);
  const change = changeSchema.safeParse((await c.req.parseBody()).change);
  if (!change.success) return c.redirect(backTo(harnessId, 'malformed_command'), 303);
  const { actor } = screen.caller;
  const request = { db: database.db, env: c.env, fetch: platformFetch, actor, at: screen.at };
  const changed = await applyRoutineChange(request, routineId, change.data);
  return c.redirect(backTo(harnessId, noticeOf(change.data, changed)), 303);
}
