import type { Logger } from '@uw/core/log';
import type { Caller, Kernel } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { sweepMail, type MailSweepLimits } from '../assistants/mail-sweep.ts';
import type { TurnStarter } from '../assistants/turn/start.ts';
import { googleAccessOf } from '../assistants/workspace.ts';

export type MailStepHost = {
  readonly env: Bindings;
  readonly database: DatabaseHandle;
  readonly fetch: typeof fetch;
  readonly kernel: Kernel;
  readonly caller: Caller;
  readonly logger: Logger;
  readonly startTurn: TurnStarter;
  readonly now: () => Date;
};

const STEP = 'assistant-mail';
const LIMITS: MailSweepLimits = { mailboxes: 25, messages: 10, budgetMs: 20_000 };

export function mailInstructionsOf(
  env: Pick<Bindings, 'ASSISTANT_EMAIL_INSTRUCTIONS'>,
): 'on' | 'off' {
  return env.ASSISTANT_EMAIL_INSTRUCTIONS === 'on' ? 'on' : 'off';
}

export async function sweepAssistantMail(host: MailStepHost): Promise<void> {
  const { env, database, logger } = host;
  const access = googleAccessOf(env, database.db, host.fetch, host.now);
  if (access === null) {
    logger.info('assistant mail not configured', {
      step: STEP,
      outcome: 'assistant_mail_not_configured',
    });
    return;
  }
  const instructions = mailInstructionsOf(env);
  const swept = await sweepMail(
    { ...host, db: database.db, tokens: access.tokens, instructions },
    LIMITS,
  );
  logger.info('assistant mail swept', {
    step: STEP,
    outcome: 'assistant_mail_swept',
    instructions,
    ...swept,
  });
}
