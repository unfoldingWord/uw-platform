import { createLogger, type Logger, type LogSink } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import { notWiredCall, type Kernel } from '@uw/harness';
import type { DatabaseHandle } from '../../database.ts';
import { hyperdriveDatabase } from '../../database.ts';
import { engineConfigOf } from '../../engines/config.ts';
import { engineRegistryOf } from '../../engines/registry.ts';
import { commitOf, type Bindings } from '../../env.ts';
import { spendCapOf } from '../../health/spend-cap.ts';
import { hubWiring, platformKernel } from '../../kernel.ts';
import { systemClock } from '../../ports/clock.ts';
import { hubOf } from '../../ports/hub.ts';
import { platformModelEngine } from '../../ports/model-engine.ts';
import { notifierOf } from '../../ports/notifier.ts';
import { directMessagesOf } from '../direct-messages.ts';
import { researchOf } from '../research.ts';
import { workspaceOf } from '../workspace.ts';
import { connectAssistantHost } from '../../mcp/assistant-host.ts';
import type { AssistantTurnDeps, HostOpener } from './run.ts';
import { assistantKernelSettings } from './settings.ts';

export type OpenedTurnDeps = { readonly deps: AssistantTurnDeps; release(): Promise<void> };

const consoleSink: LogSink = (line) => console.log(line);

function loggerOf(env: Bindings, traceId: string): Logger {
  const context = {
    traceId,
    commit: commitOf(env),
    route: 'workflow assistant-turn',
    principal: systemPrincipal().identity,
  };
  return createLogger(context, consoleSink);
}

type Fetcher = typeof fetch;

function kernelOf(env: Bindings, database: DatabaseHandle, logger: Logger, send: Fetcher): Kernel {
  const notifier = notifierOf(env, database, consoleSink);
  const directMessages = directMessagesOf({ env, database, fetch: send });
  const workspace = workspaceOf({ env, database, fetch: send });
  const research = researchOf({ env, fetch: send });
  return platformKernel(
    database,
    systemClock,
    hubWiring(hubOf(env, logger), { notifier, directMessages, workspace, research }),
    assistantKernelSettings(env),
  );
}

function hostOpener(env: Bindings, database: DatabaseHandle, kernel: Kernel, logger: Logger) {
  const opener: HostOpener = (begun, start, at) =>
    connectAssistantHost({
      kernel,
      principal: begun.principal,
      turn: { requestId: start.requestId, turnId: begun.turnId },
      tools: begun.loop.tools,
      at,
      traceId: start.traceId,
      db: database.db,
      commit: commitOf(env),
      cap: spendCapOf(env),
      logger,
    });
  return opener;
}

export function assistantTurnDepsOf(
  env: Bindings,
  traceId: string,
  send: Fetcher = fetch.bind(globalThis),
): OpenedTurnDeps | null {
  const database = hyperdriveDatabase(env);
  if (database === null) return null;
  const logger = loggerOf(env, traceId);
  const kernel = kernelOf(env, database, logger, send);
  const now = () => systemClock.now();
  const config = engineConfigOf(env, send);
  const spend = () => notWiredCall('modelEngine', 'spend');
  const engine = platformModelEngine(engineRegistryOf(config), spend);
  const deps: AssistantTurnDeps = {
    kernel,
    system: { actor: systemPrincipal(), traceId, requestId: null },
    turn: (request) => engine.turn(request),
    openHost: hostOpener(env, database, kernel, logger),
    newId: () => crypto.randomUUID(),
    now,
    logger,
  };
  return { deps, release: () => database.release() };
}
