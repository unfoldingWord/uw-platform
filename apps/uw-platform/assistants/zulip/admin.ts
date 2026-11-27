import { z } from 'zod';
import type { Timers } from '../../timers.ts';
import { zulipCall, type ZulipBody, type ZulipCall, type ZulipOutcome } from './rest.ts';

export type ZulipAdminConfig = {
  readonly site: string;
  readonly email: string;
  readonly apiKey: string;
};

type NewBot = {
  readonly fullName: string;
  readonly shortName: string;
  readonly payloadUrl: string;
};
type CreatedBot = { readonly userId: number; readonly apiKey: string };
export type BotDetails = CreatedBot & {
  readonly email: string;
  readonly token: string;
  readonly payloadUrl: string | null;
};

export type ZulipAdmin = {
  createBot(bot: NewBot): Promise<ZulipOutcome<CreatedBot>>;
  botDetails(userId: number): Promise<ZulipOutcome<BotDetails>>;
  botByShortName(shortName: string): Promise<ZulipOutcome<BotDetails | null>>;
  userIdByEmail(email: string): Promise<ZulipOutcome<number | null>>;
  deactivate(userId: number): Promise<ZulipOutcome<null>>;
  isActive(userId: number): Promise<ZulipOutcome<boolean>>;
  reactivate(userId: number): Promise<ZulipOutcome<null>>;
  renameBot(userId: number, fullName: string): Promise<ZulipOutcome<null>>;
};

const ADMIN_TIMEOUT_MS = 5_000;
const WAIT_AT_MOST_MS = 2_000;
const OUTGOING_WEBHOOK_BOT = '3';
const GENERIC_INTERFACE = '1';

const zulipId = z.number().int().positive();
const createdSchema = z.object({ user_id: zulipId, api_key: z.string().min(1).max(200) });
const listedBotSchema = z.object({
  user_id: zulipId,
  email: z.string().min(3).max(254).optional(),
  username: z.string().min(3).max(254).optional(),
  api_key: z.string().min(1).max(200),
  services: z
    .array(
      z.object({
        token: z.string().min(1).max(200).optional(),
        base_url: z.string().max(2000).optional(),
      }),
    )
    .max(10)
    .default([]),
});
const botsSchema = z.object({ bots: z.array(z.unknown()).max(10_000) });
const userSchema = z.object({ user: z.object({ user_id: zulipId }) });
const activeSchema = z.object({ user: z.object({ is_active: z.boolean() }) });

type Request = Omit<ZulipCall, 'signIn' | 'timeoutMs'>;

function parsed<T>(answer: ZulipOutcome<ZulipBody>, schema: z.ZodType<T>): ZulipOutcome<T> {
  if (!answer.ok) return answer;
  const value = schema.safeParse(answer.value);
  return value.success ? { ok: true, value: value.data } : { ok: false, failure: 'unknown' };
}

function detailsOf(entry: unknown): BotDetails | null {
  const bot = listedBotSchema.safeParse(entry);
  if (!bot.success) return null;
  const email = bot.data.email ?? bot.data.username;
  const service = bot.data.services.find((each) => each.token !== undefined);
  const token = service?.token;
  if (email === undefined || token === undefined) return null;
  const payloadUrl = service?.base_url ?? null;
  return { userId: bot.data.user_id, email, apiKey: bot.data.api_key, token, payloadUrl };
}

function asked(config: ZulipAdminConfig, fetcher: typeof fetch, timers: Timers) {
  const host = { site: config.site, fetcher, timers };
  const signIn = { email: config.email, apiKey: config.apiKey };
  return async (request: Request): Promise<ZulipOutcome<ZulipBody>> => {
    const call = { ...request, signIn, timeoutMs: ADMIN_TIMEOUT_MS };
    const first = await zulipCall(host, call);
    if (first.ok || first.failure !== 'rate_limited') return first;
    const wait = first.retryAfterMs ?? WAIT_AT_MOST_MS + 1;
    if (wait > WAIT_AT_MOST_MS) return first;
    await timers.after(wait, new AbortController().signal);
    return zulipCall(host, call);
  };
}

async function listed(ask: ReturnType<typeof asked>): Promise<ZulipOutcome<BotDetails[]>> {
  const answer = parsed(await ask({ method: 'GET', path: '/api/v1/bots' }), botsSchema);
  if (!answer.ok) return answer;
  return { ok: true, value: answer.value.bots.flatMap((entry) => detailsOf(entry) ?? []) };
}

function emptied(answer: ZulipOutcome<ZulipBody>): ZulipOutcome<null> {
  return answer.ok ? { ok: true, value: null } : answer;
}

async function userIdOf(ask: ReturnType<typeof asked>, email: string) {
  const path = `/api/v1/users/${encodeURIComponent(email)}`;
  const answer = await ask({ method: 'GET', path });
  if (!answer.ok && answer.failure === 'refused') return { ok: true as const, value: null };
  const user = parsed(answer, userSchema);
  return user.ok ? { ok: true as const, value: user.value.user.user_id } : user;
}

async function activeOf(
  ask: ReturnType<typeof asked>,
  userId: number,
): Promise<ZulipOutcome<boolean>> {
  const answer = await ask({ method: 'GET', path: `/api/v1/users/${String(userId)}` });
  const user = parsed(answer, activeSchema);
  return user.ok ? { ok: true, value: user.value.user.is_active } : user;
}

async function renamed(ask: ReturnType<typeof asked>, userId: number, fullName: string) {
  const path = `/api/v1/bots/${String(userId)}`;
  return emptied(await ask({ method: 'PATCH', path, form: { full_name: fullName } }));
}

export function zulipAdmin(
  config: ZulipAdminConfig,
  fetcher: typeof fetch,
  timers: Timers,
): ZulipAdmin {
  const ask = asked(config, fetcher, timers);
  const pick = async (match: (bot: BotDetails) => boolean) => {
    const bots = await listed(ask);
    return bots.ok ? { ok: true as const, value: bots.value.find(match) ?? null } : bots;
  };
  return {
    createBot: async (bot) => {
      const form = {
        full_name: bot.fullName,
        short_name: bot.shortName,
        bot_type: OUTGOING_WEBHOOK_BOT,
        payload_url: JSON.stringify(bot.payloadUrl),
        interface_type: GENERIC_INTERFACE,
      };
      const created = parsed(
        await ask({ method: 'POST', path: '/api/v1/bots', form }),
        createdSchema,
      );
      return created.ok
        ? { ok: true, value: { userId: created.value.user_id, apiKey: created.value.api_key } }
        : created;
    },
    botDetails: async (userId) => {
      const found = await pick((bot) => bot.userId === userId);
      if (!found.ok) return found;
      return found.value === null
        ? { ok: false, failure: 'refused' }
        : { ok: true, value: found.value };
    },
    botByShortName: (shortName) => pick((bot) => bot.email.startsWith(`${shortName}-bot@`)),
    userIdByEmail: (email) => userIdOf(ask, email),
    deactivate: async (userId) =>
      emptied(await ask({ method: 'DELETE', path: `/api/v1/bots/${String(userId)}` })),
    isActive: (userId) => activeOf(ask, userId),
    reactivate: async (userId) =>
      emptied(await ask({ method: 'POST', path: `/api/v1/users/${String(userId)}/reactivate` })),
    renameBot: (userId, fullName) => renamed(ask, userId, fullName),
  };
}
