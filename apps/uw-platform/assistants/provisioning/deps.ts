import { assistantProvisionerPrincipal } from '@uw/core/principal';
import type { Clock, Kernel } from '@uw/harness';
import { credentialsDepsOf } from '../../credentials/compose.ts';
import type { DatabaseHandle } from '../../database.ts';
import type { Bindings } from '../../env.ts';
import { systemTimers } from '../../timers.ts';
import { workspaceConfigOf } from '../google/config.ts';
import { googleDirectory } from '../google/directory.ts';
import { subjectKindOf } from '../google/subjects.ts';
import { isolateTokens } from '../workspace.ts';
import { zulipAdmin } from '../zulip/admin.ts';
import { assistantZulipConfigOf } from '../zulip/config.ts';
import type { ZulipProvisionDeps } from '../zulip/provision.ts';
import type { ProvisionerDeps, WorkspaceSide } from './types.ts';

export type ProvisionerHost = {
  readonly env: Bindings;
  readonly database: DatabaseHandle;
  readonly fetch: typeof fetch;
  readonly clock: Clock;
  readonly kernel: Kernel;
  readonly traceId: string;
};

const UNIT = /^\/[A-Za-z0-9 ._/-]{0,200}$/;

export function workspaceSideOf(
  host: Pick<ProvisionerHost, 'env' | 'database' | 'fetch' | 'clock'>,
): WorkspaceSide | null {
  const config = workspaceConfigOf(host.env);
  const unit = host.env.GOOGLE_ASSISTANT_OU?.trim() ?? '';
  if (config === null || config.adminSubject === null || !UNIT.test(unit)) return null;
  const { adminSubject, domain } = config;
  const db = host.database.db;
  const tokens = {
    account: config.account,
    fetcher: host.fetch,
    now: () => host.clock.now(),
    lookup: async (email: string) =>
      email === adminSubject ? ('admin' as const) : subjectKindOf(db, email, domain),
    cache: isolateTokens,
  };
  return { directory: googleDirectory({ tokens, adminSubject }), domain, unit };
}

function zulipSideOf(host: ProvisionerHost): ZulipProvisionDeps | null {
  const config = assistantZulipConfigOf(host.env);
  if (config === null) return null;
  const platform = {
    fetch: host.fetch,
    timers: systemTimers,
    clock: host.clock,
    newId: () => crypto.randomUUID(),
  };
  const { keys } = credentialsDepsOf(host.env, host.database.db, platform);
  return {
    db: host.database.db,
    kernel: host.kernel,
    keys,
    admin: zulipAdmin(config.admin, host.fetch, systemTimers),
    webhookUrl: config.webhookUrl,
    clock: host.clock,
    caller: { actor: assistantProvisionerPrincipal(), traceId: host.traceId, requestId: null },
  };
}

export function provisionerOf(host: ProvisionerHost): ProvisionerDeps {
  return {
    db: host.database.db,
    kernel: host.kernel,
    clock: host.clock,
    newId: () => crypto.randomUUID(),
    caller: { actor: assistantProvisionerPrincipal(), traceId: host.traceId, requestId: null },
    workspace: workspaceSideOf(host),
    zulip: zulipSideOf(host),
  };
}
