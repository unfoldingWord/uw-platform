import type { Caller, Clock, Kernel } from '@uw/harness';
import type { Executor } from '@uw/db/client';
import type { DataKeys } from '../../credentials/data-keys.ts';
import type { BotDetails, ZulipAdmin } from './admin.ts';
import {
  botHeld,
  botOfHarness,
  insertBot,
  setBotFullName,
  setBotStatus,
  type BotRow,
} from './bots.ts';
import { sha256Hex } from './digest.ts';
import { sealBotKey } from '../../credentials/assistant-bot-keys.ts';
import type { ZulipFailure, ZulipOutcome } from './rest.ts';

export type ZulipProvisionDeps = {
  readonly db: Executor;
  readonly kernel: Kernel;
  readonly keys: DataKeys;
  readonly admin: ZulipAdmin;
  readonly webhookUrl: string;
  readonly clock: Clock;
  readonly caller: Caller;
};

export type ZulipBotRequest = {
  readonly harnessId: string;
  readonly personId: string;
  readonly personEmail: string;
  readonly name: string;
};

type ProvisionFailure =
  'zulip_rate_limited' | 'zulip_refused' | 'zulip_unknown' | 'key_not_sealed' | 'no_bot';

type Failed = { readonly outcome: 'failed'; readonly why: ProvisionFailure };
export type ZulipProvisioned =
  | {
      readonly outcome: 'provisioned' | 'already';
      readonly botUserId: number;
      readonly paired: boolean;
    }
  | Failed;
export type ZulipBotState = { readonly outcome: 'active' | 'deactivated' } | Failed;

const failureWhy: Readonly<Record<ZulipFailure, ProvisionFailure>> = {
  rate_limited: 'zulip_rate_limited',
  refused: 'zulip_refused',
  unknown: 'zulip_unknown',
};

function failed(why: ProvisionFailure): Failed {
  return { outcome: 'failed', why };
}

const HARNESS_SUFFIX = 12;

export function botShortName(name: string, harnessId: string): string {
  return `${name}-${harnessId.replaceAll('-', '').slice(-HARNESS_SUFFIX)}`;
}

async function adoptable(deps: ZulipProvisionDeps, bot: BotDetails): Promise<boolean> {
  if (bot.payloadUrl !== deps.webhookUrl) return false;
  return !(await botHeld(deps.db, bot.userId));
}

async function adoptedOrCreated(
  deps: ZulipProvisionDeps,
  request: ZulipBotRequest,
): Promise<ZulipOutcome<BotDetails>> {
  const shortName = botShortName(request.name, request.harnessId);
  const earlier = await deps.admin.botByShortName(shortName);
  if (!earlier.ok) return earlier;
  if (earlier.value !== null) {
    return (await adoptable(deps, earlier.value))
      ? { ok: true, value: earlier.value }
      : { ok: false, failure: 'refused' };
  }
  const created = await deps.admin.createBot({
    fullName: request.name,
    shortName,
    payloadUrl: deps.webhookUrl,
  });
  return created.ok ? deps.admin.botDetails(created.value.userId) : created;
}

async function pairedByEmail(deps: ZulipProvisionDeps, request: ZulipBotRequest): Promise<boolean> {
  const found = await deps.admin.userIdByEmail(request.personEmail);
  if (!found.ok || found.value === null) return false;
  const bound = await deps.kernel.assistants.bindAddress(deps.caller, {
    personId: request.personId,
    channel: 'zulip_dm',
    address: `zulip:${String(found.value)}`,
  });
  return bound.status === 'accepted';
}

async function stored(
  deps: ZulipProvisionDeps,
  request: ZulipBotRequest,
  details: BotDetails,
): Promise<BotRow | null> {
  const owner = { harnessId: request.harnessId, botUserId: details.userId };
  const sealedKey = await sealBotKey(deps.keys, owner, details.apiKey);
  if (sealedKey === null) return null;
  const at = deps.clock.now();
  const row: BotRow = {
    ...owner,
    personId: request.personId,
    botEmail: details.email,
    fullName: request.name,
    sealedKey,
    webhookTokenDigest: await sha256Hex(details.token),
    status: 'active',
    createdAt: at,
    updatedAt: at,
  };
  await insertBot(deps.db, row);
  return botOfHarness(deps.db, request.harnessId);
}

export async function provisionZulipBot(
  deps: ZulipProvisionDeps,
  request: ZulipBotRequest,
): Promise<ZulipProvisioned> {
  const existing = await botOfHarness(deps.db, request.harnessId);
  if (existing !== null) {
    const paired = await pairedByEmail(deps, request);
    return { outcome: 'already', botUserId: existing.botUserId, paired };
  }
  const details = await adoptedOrCreated(deps, request);
  if (!details.ok) return failed(failureWhy[details.failure]);
  const row = await stored(deps, request, details.value);
  if (row === null) return failed('key_not_sealed');
  const paired = await pairedByEmail(deps, request);
  return { outcome: 'provisioned', botUserId: row.botUserId, paired };
}

async function confirmed(
  deps: ZulipProvisionDeps,
  botUserId: number,
  to: 'active' | 'deactivated',
): Promise<Failed | null> {
  const answer =
    to === 'active'
      ? await deps.admin.reactivate(botUserId)
      : await deps.admin.deactivate(botUserId);
  if (answer.ok) return null;
  if (answer.failure !== 'refused') return failed(failureWhy[answer.failure]);
  const active = await deps.admin.isActive(botUserId);
  if (!active.ok) return failed(failureWhy[active.failure]);
  return active.value === (to === 'active') ? null : failed('zulip_refused');
}

async function switched(
  deps: ZulipProvisionDeps,
  harnessId: string,
  to: 'active' | 'deactivated',
): Promise<ZulipBotState> {
  const bot = await botOfHarness(deps.db, harnessId);
  if (bot === null) return failed('no_bot');
  if (bot.status !== to) {
    const refusal = await confirmed(deps, bot.botUserId, to);
    if (refusal !== null) return refusal;
    await setBotStatus(deps.db, harnessId, to, deps.clock.now());
  }
  return { outcome: to };
}

export function deactivateZulipBot(
  deps: ZulipProvisionDeps,
  harnessId: string,
): Promise<ZulipBotState> {
  return switched(deps, harnessId, 'deactivated');
}

export function reactivateZulipBot(
  deps: ZulipProvisionDeps,
  harnessId: string,
): Promise<ZulipBotState> {
  return switched(deps, harnessId, 'active');
}

export async function renameZulipBot(
  deps: ZulipProvisionDeps,
  harnessId: string,
  fullName: string,
): Promise<ZulipBotState> {
  const bot = await botOfHarness(deps.db, harnessId);
  if (bot === null) return failed('no_bot');
  if (bot.fullName !== fullName) {
    const answer = await deps.admin.renameBot(bot.botUserId, fullName);
    if (!answer.ok) return failed(failureWhy[answer.failure]);
    await setBotFullName(deps.db, harnessId, fullName, deps.clock.now());
  }
  return { outcome: bot.status };
}
