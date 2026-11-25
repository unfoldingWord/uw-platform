import type { Holding } from './holder.tsx';
import { shownIdentity, Who } from './person.tsx';
import { formatDate } from '@uw/core/dates';
import { grantableFor, type AgentsView, type StandingPermission } from '@uw/harness';
import { Button } from '@uw/ui/components/button.tsx';
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { fieldControl, fieldLabel, SelectField } from '@uw/ui/components/field.tsx';
import { Section } from '@uw/ui/components/section.tsx';
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

export type PermissionViewer = {
  readonly admin: boolean;
  readonly personId: string | null;
  readonly holding: Holding;
};

function mayRevoke(viewer: PermissionViewer, permission: StandingPermission): boolean {
  return viewer.admin || viewer.personId === permission.personId;
}

function Revoke(props: { readonly harnessId: string; readonly permission: StandingPermission }) {
  const { permission } = props;
  return (
    <CommandForm harnessId={props.harnessId} command="revoke_delegation" itemId={permission.id}>
      <input type="hidden" name="delegationId" value={permission.id} />
      <Button
        type="submit"
        size="sm"
        label={`Revoke ${capabilityWord(permission.capability)} for ${permission.agentTitle ?? permission.persona}`}
      >
        Revoke
      </Button>
    </CommandForm>
  );
}

function rowOf(view: AgentsView, viewer: PermissionViewer, permission: StandingPermission) {
  const tier = permission.maxTier === null ? '' : ` (up to ${permission.maxTier} risk)`;
  return {
    agent: permission.agentTitle ?? permission.persona,
    may: `${capabilityWord(permission.capability)}${tier}`,
    granted: (
      <Who
        reading={viewer.holding.reading}
        who={shownIdentity(
          `human:${permission.personId}`,
          viewer.holding.names,
          () => permission.grantedByName,
        )}
      />
    ),
    ends: formatDate(permission.expiresAt),
    revoke: mayRevoke(viewer, permission) ? (
      <Revoke harnessId={view.harness.id} permission={permission} />
    ) : null,
  };
}

export function EndsField(props: { readonly scope: string }) {
  const id = domId('field', 'expiresOn', props.scope);
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <label for={id} class={fieldLabel}>
        Ends
      </label>
      <input id={id} type="date" name="expiresOn" class={fieldControl} />
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
      <p class="m-0 text-sm text-text-3">
        An agent needs to be live, with a kind of work, before it can be given a standing
        permission.
      </p>
    );
  }
  const scope = view.harness.id;
  return (
    <div class="flex flex-col gap-2">
      <CommandForm harnessId={view.harness.id} command="schedule_regular_tweak">
        <SelectField name="grant" label="Agent and kind of work" scope={scope} choices={pairs} />
        <EndsField scope={scope} />
        <Button type="submit">Grant</Button>
      </CommandForm>
      <p class="m-0 text-xs text-text-3">
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
    <Section title="Standing permissions" sub="Let an agent work without someone starting each run">
      {view.permissions.length === 0 ? (
        <EmptyState
          title="No standing permissions on this workflow."
          text="An admin grants one to a live agent for one kind of work."
        />
      ) : (
        <Table
          caption="Standing permissions"
          columns={columns}
          rows={view.permissions.map((permission) => rowOf(view, viewer, permission))}
          bare
        />
      )}
      {view.admin ? <GrantForm view={view} /> : null}
      <p class="m-0 text-sm text-text-3">
        Each one covers one kind of work and reaches only the stages in the matching phase: build,
        review and fix reach the build stages, iterate reaches the iterate stages, and merge reaches
        a stage whose exit an agent may decide.
      </p>
    </Section>
  );
}
