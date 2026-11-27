import { botOfHarness } from '../zulip/bots.ts';
import {
  deactivateZulipBot,
  provisionZulipBot,
  reactivateZulipBot,
  renameZulipBot,
  type ZulipBotState,
  type ZulipProvisioned,
} from '../zulip/provision.ts';
import type { AccountWork } from './rows.ts';
import { done, failed, type ProvisionerDeps, type StepOutcome } from './types.ts';

type Answer = ZulipProvisioned | ZulipBotState;
type Why = Extract<Answer, { outcome: 'failed' }>['why'];

const failureOf = {
  zulip_rate_limited: failed('zulip_rate_limited'),
  zulip_refused: failed('zulip_refused'),
  zulip_unknown: failed('zulip_unknown'),
  key_not_sealed: failed('key_not_sealed'),
  no_bot: failed('zulip_unknown'),
} as const satisfies Record<Why, StepOutcome>;

function outcomeOf(answer: Answer): StepOutcome {
  return answer.outcome === 'failed' ? failureOf[answer.why] : done;
}

export async function zulipBot(deps: ProvisionerDeps, work: AccountWork): Promise<StepOutcome> {
  const zulip = deps.zulip;
  if (zulip === null) return failed('zulip_not_wired');
  const bot = await botOfHarness(deps.db, work.harnessId);
  if (bot === null) {
    const request = {
      harnessId: work.harnessId,
      personId: work.personId,
      personEmail: work.personEmail,
      name: work.name,
    };
    return outcomeOf(await provisionZulipBot(zulip, request));
  }
  if (bot.status === 'deactivated') {
    const back = outcomeOf(await reactivateZulipBot(zulip, work.harnessId));
    if (back.kind !== 'done') return back;
  }
  return outcomeOf(await renameZulipBot(zulip, work.harnessId, work.name));
}

export async function deactivateBot(
  deps: ProvisionerDeps,
  work: AccountWork,
): Promise<StepOutcome> {
  const bot = await botOfHarness(deps.db, work.harnessId);
  if (bot === null || bot.status === 'deactivated') return done;
  const zulip = deps.zulip;
  if (zulip === null) return failed('zulip_not_wired');
  return outcomeOf(await deactivateZulipBot(zulip, work.harnessId));
}
