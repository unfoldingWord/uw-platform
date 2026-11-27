import type {
  AssistantProvisioningFailure,
  AssistantProvisioningStatus,
  AssistantProvisioningStep,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { mailboxOf } from './google/subjects.ts';
import { progressOf } from './provisioning/rows.ts';
import { botOfHarness } from './zulip/bots.ts';

export type AccountsSummary = {
  readonly mailbox: { readonly address: string; readonly status: string } | null;
  readonly bot: {
    readonly fullName: string;
    readonly email: string;
    readonly status: string;
  } | null;
  readonly progress: {
    readonly step: AssistantProvisioningStep;
    readonly status: AssistantProvisioningStatus;
    readonly failure: AssistantProvisioningFailure | null;
  } | null;
};

export async function accountsSummary(db: Executor, harnessId: string): Promise<AccountsSummary> {
  const mailbox = await mailboxOf(db, harnessId);
  const bot = await botOfHarness(db, harnessId);
  const progress = await progressOf(db, harnessId);
  return {
    mailbox: mailbox === null ? null : { address: mailbox.address, status: mailbox.status },
    bot: bot === null ? null : { fullName: bot.fullName, email: bot.botEmail, status: bot.status },
    progress:
      progress === null
        ? null
        : { step: progress.step, status: progress.status, failure: progress.failure },
  };
}
