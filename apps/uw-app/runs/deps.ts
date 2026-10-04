import { createLogger, type Logger, type LogSink } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, Clock, Kernel } from '@uw/harness';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { engineConfigOf } from '../engines/config.ts';
import { gatewaySpend } from '../engines/gateway/spend.ts';
import { engineRegistryOf, type EngineRegistry } from '../engines/registry.ts';
import { commitOf, type Bindings } from '../env.ts';
import { githubAppOf } from '../github/app-config.ts';
import { builderAppOf, builderTokens } from '../github/builder-app.ts';
import { defaultBranchOf, openPullRequestFrom } from '../github/facts/queries.ts';
import { spendCapOf, type SpendCap } from '../health/spend-cap.ts';
import { createGitHubReads } from '../github/client.ts';
import { reviewerAppsOf } from '../github/reviewer-apps.ts';
import { platformGitHubTransport } from '../github/transport.ts';
import { hubWiring, platformKernel, runWiring } from '../kernel.ts';
import { systemClock } from '../ports/clock.ts';
import { hubOf } from '../ports/hub.ts';
import { notifierOf } from '../ports/notifier.ts';
import { platformModelEngine } from '../ports/model-engine.ts';
import { runsOf } from '../ports/runs.ts';

export type BuilderGitHub = {
  readonly defaultBranch: (repository: string) => Promise<string | null>;
  readonly token: (repository: string) => () => Promise<string | null>;
  readonly openPullRequest: (
    repository: string,
    branch: string,
  ) => Promise<{ readonly number: number; readonly head: string } | null>;
};

export type RunDeps = {
  readonly verbKernel: Kernel;
  readonly runKernel: Kernel;
  readonly host: Caller;
  readonly db: Database;
  readonly commit: string;
  readonly cap: SpendCap;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly engines: EngineRegistry;
  readonly scout: { readonly model: string; readonly provider: string };
  readonly builder: BuilderGitHub;
};

export type OpenedRunDeps = { readonly deps: RunDeps; release(): Promise<void> };

const ALWAYS_ON_MODEL = 'z-ai/glm-5.3-flash';
const ALWAYS_ON_PROVIDER = 'z-ai';

const consoleSink: LogSink = (line) => console.log(line);

function loggerOf(env: Bindings, traceId: string): Logger {
  const context = {
    traceId,
    commit: commitOf(env),
    route: 'workflow harness-run',
    principal: systemPrincipal().identity,
  };
  return createLogger(context, consoleSink);
}

function runKernelOf(env: Bindings, database: DatabaseHandle, logger: Logger) {
  const send = fetch.bind(globalThis);
  const config = engineConfigOf(env, send);
  const now = () => systemClock.now();
  const app = githubAppOf(env);
  const transport = platformGitHubTransport(now);
  const reads = app === null ? null : { open: () => createGitHubReads(app, transport), logger };
  const apps = reviewerAppsOf(env);
  const reviews = apps.size === 0 ? null : { apps, transport };
  const engines = engineRegistryOf(config);
  const modelEngine = platformModelEngine(engines, gatewaySpend(config, now));
  const notifier = notifierOf(env, database, consoleSink);
  const host = { hub: hubOf(env, logger), runs: runsOf(env), modelEngine, notifier };
  const kernel = platformKernel(database, systemClock, runWiring(host, reads, reviews));
  return { kernel, engines };
}

function builderOf(env: Bindings, db: Database): BuilderGitHub {
  const transport = platformGitHubTransport(() => systemClock.now());
  return {
    defaultBranch: (repository) => defaultBranchOf(db, repository),
    token: builderTokens(builderAppOf(env), transport),
    openPullRequest: (repository, branch) => openPullRequestFrom(db, repository, branch),
  };
}

export function runDepsOf(env: Bindings, traceId: string): OpenedRunDeps {
  const database = hyperdriveDatabase(env);
  if (database === null) throw new Error('the run host has no database');
  const logger = loggerOf(env, traceId);
  const { kernel, engines } = runKernelOf(env, database, logger);
  const deps: RunDeps = {
    verbKernel: platformKernel(
      database,
      systemClock,
      hubWiring(hubOf(env, logger), { notifier: notifierOf(env, database, consoleSink) }),
    ),
    runKernel: kernel,
    host: { actor: systemPrincipal(), traceId, requestId: null },
    db: database.db,
    commit: commitOf(env),
    cap: spendCapOf(env),
    logger,
    clock: systemClock,
    engines,
    scout: {
      model: env.ALWAYS_ON_MODEL ?? ALWAYS_ON_MODEL,
      provider: env.ALWAYS_ON_PROVIDER ?? ALWAYS_ON_PROVIDER,
    },
    builder: builderOf(env, database.db),
  };
  return { deps, release: () => database.release() };
}
