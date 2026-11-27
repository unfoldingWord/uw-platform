import type { Principal } from '@uw/core/principal';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { hubWiring, platformKernel } from '../kernel.ts';
import { hubNotWired } from '../ports/hub.not-wired.ts';
import { workspaceOf } from '../assistants/workspace.ts';
import { assistantNameTaken } from '../assistants/google/name-check.ts';
import type { AssistantCommandDeps } from './person/assistant.ts';
import { provisionerOf, workspaceSideOf } from '../assistants/provisioning/deps.ts';
import { driveHarness } from '../assistants/provisioning/provisioner.ts';
import { heldAccount } from '../assistants/provisioning/rows.ts';

export type AssistantCommandHost = {
  readonly env: Bindings;
  readonly database: DatabaseHandle;
  readonly fetch: typeof fetch;
  readonly actor: Principal;
  readonly traceId: string;
  readonly at: Date;
  readonly requestId: string;
};

export function assistantCommandDepsOf(host: AssistantCommandHost): AssistantCommandDeps {
  const clock = { now: () => host.at };
  const workspace = workspaceOf(host);
  const kernel = platformKernel(host.database, clock, hubWiring(hubNotWired, { workspace }));
  const personId = host.actor.personId;
  const held = async () => (personId === null ? null : heldAccount(host.database.db, personId));
  return {
    kernel,
    caller: { actor: host.actor, traceId: host.traceId, requestId: host.requestId },
    held,
    nameTaken: async (name) => {
      const account = await held();
      if (account?.live === true && account.name === name) return false;
      const side = workspaceSideOf({ ...host, clock });
      if (side === null) return false;
      return assistantNameTaken(side, name, account?.harnessId ?? null);
    },
    drive: async (harnessId) => {
      try {
        await driveHarness(provisionerOf({ ...host, clock, kernel }), harnessId);
      } catch {
        return;
      }
    },
  };
}
