import { formatDate } from '@uw/core/dates';
import { grantableFor, type AgentsView, type StandingPermission } from '@uw/harness';
import { Card } from '@uw/ui/components/card.tsx';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { SelectField } from '@uw/ui/components/field.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { domId } from '@uw/ui/components/text.ts';
import { capabilityWord } from './agent-words.ts';

const columns = [
  { key: 'agent', label: 'Agent' },
  { key: 'may', label: 'May' },
  { key: 'granted', label: 'Granted by' },
  { key: 'ends', label: 'Ends' },
  { key: 'revoke', label: 'Revoke' },
];

const dateControl =
  'rounded-md border border-line bg-surface px-3 py-1 text-sm text-text outline-offset-2 outline-accent-text focus-visible:outline-2';

export type PermissionViewer = { readonly admin: boolean; readonly personId: string | null };

function mayRevoke(viewer: PermissionViewer, permission: StandingPermission): boolean {
  return viewer.admin || viewer.personId === permission.personId;
}

function Revoke(props: { readonly harnessId: string; readonly permission: StandingPermission }) {
  const { permission } = props;
  return (
    <CommandForm harnessId={props.harnessId} command="revoke_delegation" itemId={permission.id}>
      <input type="hidden" name="delegationId" value={permission.id} />
      <button
        type="submit"
        class={commandButton}
        aria-label={`Revoke ${capabilityWord(permission.capability)} for ${permission.agentTitle ?? permission.persona}`}
      >
        Revoke
      </button>
    </CommandForm>
  );
}

function rowOf(view: AgentsView, viewer: PermissionViewer, permission: StandingPermission) {
  const tier = permission.maxTier === null ? '' : ` (up to ${permission.maxTier} risk)`;
  return {
    agent: permission.agentTitle ?? permission.persona,
    may: `${capabilityWord(permission.capability)}${tier}`,
    granted: permission.grantedByName,
    ends: formatDate(permission.expiresAt),
    revoke: mayRevoke(viewer, permission) ? (
      <Revoke harnessId={view.harness.id} permission={permission} />
    ) : null,
  };
}

function EndsField(props: { readonly scope: string }) {
  const id = domId('field', 'expiresOn', props.scope);
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <label for={id} class="text-xs font-heavy tracking-wide text-text-3 uppercase">
        Ends
      </label>
      <input id={id} type="date" name="expiresOn" class={dateControl} />
    </div>
  );
}

const MERGE_TIERS = ['low', 'standard'] as const;

export function grantPairs(view: AgentsView): readonly { value: string; label: string }[] {
  return view.agents
    .filter((agent) => agent.status === 'active')
    .flatMap((agent) =>
      grantableFor(agent.capability).flatMap((kind) => {
        const value = `${agent.identity}|${kind}`;
        const label = `${agent.title} · ${capabilityWord(kind)}`;
        if (kind !== 'merge') return [{ value, label }];
        return MERGE_TIERS.map((tier) => ({
          value: `${value}|${tier}`,
          label: `${label}, up to ${tier} risk`,
        }));
      }),
    );
}

function GrantForm(props: { readonly view: AgentsView }) {
  const { view } = props;
  const pairs = grantPairs(view);
  if (pairs.length === 0) {
    return (
      <p class="m-0 border-t border-line px-4 py-3 text-sm text-text-3">
        An agent needs to be live, with a kind of work, before it can be given a standing
        permission.
      </p>
    );
  }
  const scope = view.harness.id;
  return (
    <div class="border-t border-line px-4 py-3">
      <CommandForm harnessId={view.harness.id} command="schedule_regular_tweak">
        <SelectField name="grant" label="Agent and kind of work" scope={scope} choices={pairs} />
        <EndsField scope={scope} />
        <button type="submit" class={commandButton}>
          Grant
        </button>
      </CommandForm>
      <p class="m-0 mt-2 text-xs text-text-3">
        With no end date, it lasts 90 days. You can revoke it at any time.
      </p>
    </div>
  );
}

export function StandingPermissions(props: {
  readonly view: AgentsView;
  readonly viewer: PermissionViewer;
}) {
  const { view, viewer } = props;
  return (
    <Card
      title="Standing permissions"
      sub="Let an agent work without someone starting each run"
      flush
    >
      {view.permissions.length === 0 ? (
        <p class="m-0 px-4 py-3 text-sm text-text-3">No standing permissions on this workflow.</p>
      ) : (
        <Table
          caption="Standing permissions"
          columns={columns}
          rows={view.permissions.map((permission) => rowOf(view, viewer, permission))}
          bare
        />
      )}
      {view.admin ? <GrantForm view={view} /> : null}
      <p class="m-0 border-t border-line px-4 py-3 text-sm text-text-3">
        Each one covers one kind of work and reaches only the stages in the matching phase: build,
        review and fix reach the build stages, iterate reaches the iterate stages, and merge reaches
        a stage whose exit an agent may decide.
      </p>
    </Card>
  );
}
