import { systemTimers } from '../../timers.ts';
import { zulipAdmin, type BotDetails, type ZulipAdmin } from '../zulip/admin.ts';
import { assistantZulipConfigOf, type AssistantZulipConfig } from '../zulip/config.ts';
import { sendDirect } from '../zulip/direct.ts';
import { checked, failed, skipped, type ProbeResult } from './report.ts';
import { addressOf, bindingsOf, notConfigured, WRITES_ONLY, type ProbeDeps } from './setup.ts';

const SETTINGS = [
  'ZULIP_SITE',
  'ZULIP_ADMIN_EMAIL',
  'ZULIP_ADMIN_API_KEY',
  'ASSISTANT_WEBHOOK_BASE',
  'PROBE_PERSON_EMAIL',
];
const READS = ['s3.3', 's3.2'];
const WRITES = ['s3.1', 's3.5', 's6.5', 's3.4'];
const SEND_TIMEOUT_MS = 5_000;
const PROBE_TEXT = 'uw-platform staging probe: nothing to do, you can ignore this message.';

type Rig = {
  readonly admin: ZulipAdmin;
  readonly config: AssistantZulipConfig;
  readonly deps: ProbeDeps;
};

async function lookup(admin: ZulipAdmin, person: string, suffix: string) {
  const found = await admin.userIdByEmail(person);
  const unknown = await admin.userIdByEmail(`uw-probe-none-${suffix}@example.invalid`);
  const ok = found.ok && found.value !== null && unknown.ok && unknown.value === null;
  const detail = `person ${found.ok ? String(found.value) : found.failure}, unknown address ${unknown.ok ? String(unknown.value) : unknown.failure}`;
  return { result: checked('s3.3', ok, detail), personId: found.ok ? found.value : null };
}

async function listing(admin: ZulipAdmin, suffix: string): Promise<ProbeResult> {
  const none = await admin.botByShortName(`uwprobenone${suffix}`);
  const detail = none.ok ? 'GET /api/v1/bots parsed' : `GET /api/v1/bots ${none.failure}`;
  return checked('s3.2', none.ok && none.value === null, detail);
}

async function created(rig: Rig): Promise<BotDetails | ProbeResult> {
  const shortName = `uwprobe${rig.deps.suffix}`;
  const bot = await rig.admin.createBot({
    fullName: `uw probe ${rig.deps.suffix}`,
    shortName,
    payloadUrl: rig.config.webhookUrl,
  });
  if (!bot.ok) return failed('s3.1', `POST /api/v1/bots ${bot.failure}`);
  const details = await rig.admin.botDetails(bot.value.userId);
  if (!details.ok) return failed('s3.1', `bot ${String(bot.value.userId)} not listed with a token`);
  return details.value;
}

async function direct(rig: Rig, bot: BotDetails, personId: number): Promise<ProbeResult> {
  const host = {
    site: rig.config.admin.site,
    fetcher: rig.deps.fetcher,
    timers: systemTimers,
    bot: { email: bot.email, apiKey: bot.apiKey },
  };
  const sent = await sendDirect(host, {
    toUserId: personId,
    content: PROBE_TEXT,
    timeoutMs: SEND_TIMEOUT_MS,
  });
  return checked('s3.5', sent.ok, sent.ok ? 'type=direct accepted' : `refused: ${sent.failure}`);
}

async function switched(admin: ZulipAdmin, userId: number): Promise<ProbeResult> {
  const off = await admin.deactivate(userId);
  const again = await admin.deactivate(userId);
  const on = await admin.reactivate(userId);
  const cleanup = await admin.deactivate(userId);
  const detail = `deactivate ${off.ok ? 'ok' : off.failure}, repeat ${again.ok ? 'ok' : again.failure}, reactivate ${on.ok ? 'ok' : on.failure}, left deactivated ${cleanup.ok ? 'yes' : 'no'}`;
  return checked('s3.4', off.ok && on.ok && cleanup.ok, detail);
}

async function lifecycle(rig: Rig, personId: number | null): Promise<ProbeResult[]> {
  const bot = await created(rig);
  if ('status' in bot) return [bot, ...WRITES.slice(1).map((id) => skipped(id, 'no probe bot'))];
  const made = checked('s3.1', bot.token !== '', `bot ${bot.email} with a webhook token`);
  const sent =
    personId === null
      ? skipped('s3.5', 'the probe person has no Zulip user')
      : await direct(rig, bot, personId);
  const renamed = await rig.admin.renameBot(bot.userId, `uw probe renamed ${rig.deps.suffix}`);
  const rename = checked(
    's6.5',
    renamed.ok,
    renamed.ok ? 'renamed' : `refused: ${renamed.failure}`,
  );
  return [made, sent, rename, await switched(rig.admin, bot.userId)];
}

export async function zulipProbes(deps: ProbeDeps): Promise<ProbeResult[]> {
  const config = assistantZulipConfigOf(bindingsOf(deps.env));
  const person = addressOf(deps.env, 'PROBE_PERSON_EMAIL');
  if (config === null || person === null) {
    const why = notConfigured(deps.env, SETTINGS);
    return [...READS, ...WRITES].map((id) => skipped(id, why));
  }
  const admin = zulipAdmin(config.admin, deps.fetcher, systemTimers);
  const found = await lookup(admin, person, deps.suffix);
  const reads = [found.result, await listing(admin, deps.suffix)];
  if (!deps.write) return [...reads, ...WRITES.map((id) => skipped(id, WRITES_ONLY))];
  return [...reads, ...(await lifecycle({ admin, config, deps }, found.personId))];
}
