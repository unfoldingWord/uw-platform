import { errorFields, type Logger } from '@uw/core/log';
import type { Caller, Clock, Kernel } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { githubAppOf } from '../github/app-config.ts';
import { createGitHubReads } from '../github/client.ts';
import { platformGitHubTransport } from '../github/transport.ts';
import { hubWiring, platformKernel, type LiveWiring } from '../kernel.ts';
import type { ShipGitHub } from '../ports/connectors.ts';

const EXIT_LIMIT = 50;
const STEP = 'delegated_exits';

export type DelegatedRun = {
  readonly database: DatabaseHandle;
  readonly env: Bindings;
  readonly clock: Clock;
  readonly live: LiveWiring;
  readonly caller: Caller;
  readonly logger: Logger;
};

function cronShipGitHub(env: Bindings, clock: Clock): ShipGitHub | null {
  const app = githubAppOf(env);
  return app === null ? null : { app, transport: platformGitHubTransport(() => clock.now()) };
}

function delegatedExitKernel(run: DelegatedRun, github: ShipGitHub): Kernel {
  const reads = { open: () => createGitHubReads(github.app, github.transport), logger: run.logger };
  const wiring = hubWiring(run.live.hub, { runs: run.live.runs, notifier: run.live.notifier });
  return platformKernel(run.database, run.clock, { ...wiring, reads, ship: github });
}

export async function exitDelegatedMerges(
  kernel: Kernel,
  run: Pick<DelegatedRun, 'caller' | 'logger'>,
): Promise<void> {
  const outcome = await kernel.gates.exitDelegated(run.caller, { limit: EXIT_LIMIT });
  if (outcome.status !== 'accepted') {
    run.logger.warn('delegated exits refused', { step: STEP, outcome: outcome.reason });
    return;
  }
  const { exited } = outcome.value;
  const merged = exited.filter((entry) => entry.advanced).length;
  run.logger.info('delegated exits run', {
    step: STEP,
    outcome: 'delegated_exits_run',
    exited: exited.length,
    merged,
  });
}

export async function runDelegatedExits(run: DelegatedRun): Promise<void> {
  const github = cronShipGitHub(run.env, run.clock);
  if (github === null) {
    run.logger.info('delegated exits skipped: no GitHub App', {
      step: STEP,
      outcome: 'github_not_configured',
    });
    return;
  }
  try {
    await exitDelegatedMerges(delegatedExitKernel(run, github), run);
  } catch (error) {
    run.logger.error('minute step failed', {
      step: STEP,
      outcome: 'internal_error',
      ...errorFields(error),
    });
  }
}
