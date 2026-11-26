export type ReadGovernance =
  | { readonly how: 'rule'; readonly appliedIn: string }
  | { readonly how: 'derived' }
  | { readonly how: 'platform' };

const platform: ReadGovernance = { how: 'platform' };
const derived: ReadGovernance = { how: 'derived' };

function rule(appliedIn: string): ReadGovernance {
  return { how: 'rule', appliedIn };
}

const accessView = 'apps/uw-platform/views/parts/access-view.ts';
const credentialRecords = 'apps/uw-platform/credentials/records.ts';
const readableDelegations = 'packages/harness/delegations/readable.ts';

export const restrictedReads: ReadonlyMap<string, ReadGovernance> = new Map<string, ReadGovernance>(
  [
    ['packages/db/store/access.ts', rule(accessView)],
    ['apps/uw-platform/agents/routines.ts', rule('apps/uw-platform/views/screens/agents.tsx')],
    ['packages/harness/delegations/commands.ts', rule(readableDelegations)],
    ['packages/harness/views/plane-list.ts', rule(readableDelegations)],
    ['packages/harness/views/agents.ts', rule('packages/harness/views/agents.ts')],
    ['packages/harness/views/persona.ts', rule('packages/harness/views/persona.ts')],
    ['packages/harness/views/waiting.ts', rule('packages/harness/views/waiting.ts')],
    [credentialRecords, rule(credentialRecords)],
    [
      'apps/uw-platform/collections/query/run.ts',
      rule('apps/uw-platform/collections/query/scope.ts'),
    ],
    ['packages/harness/views/gates.ts', derived],
    ['packages/harness/views/holder.ts', derived],
    ['packages/harness/views/look.ts', derived],
    ['packages/harness/views/plane.ts', derived],
    ['apps/uw-platform/acl/default-grant.ts', platform],
    ['apps/uw-platform/acl/grant-commands.ts', platform],
    ['apps/uw-platform/agents/service-tokens.ts', platform],
    ['apps/uw-platform/assistants/zulip/bots.ts', platform],
    ['apps/uw-ingest/deliveries/bot-tokens.ts', platform],
    ['apps/uw-platform/credentials/bindings.ts', platform],
    ['apps/uw-platform/credentials/open.ts', platform],
    ['apps/uw-platform/credentials/reveal-grants.ts', platform],
    ['apps/uw-platform/credentials/revoke.ts', platform],
    ['apps/uw-platform/credentials/standing.ts', platform],
    ['apps/uw-platform/credentials/store.ts', platform],
    ['apps/uw-platform/notify/push/store.ts', platform],
    ['packages/db/bootstrap-admin.ts', platform],
    ['packages/db/store/assistant-pairing.ts', platform],
    ['packages/db/store/assistant-reminders.ts', platform],
    ['packages/db/store/assistants.ts', platform],
    ['packages/db/store/delegations.ts', platform],
    ['packages/db/store/gate-decisions.ts', platform],
    ['packages/db/store/grants.ts', platform],
    ['packages/harness/reads/scene.ts', platform],
    ['packages/harness/alarms/', platform],
    ['packages/harness/assistants/', platform],
    ['packages/harness/delegations/', platform],
    ['packages/harness/gates/', platform],
    ['packages/harness/items/', platform],
    ['packages/harness/notify/', platform],
    ['packages/harness/runs/', platform],
    ['packages/harness/stages/', platform],
  ],
);
