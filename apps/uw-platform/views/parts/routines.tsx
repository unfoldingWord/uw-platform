import type { Holding } from './holder.tsx';
import { shownIdentity, Who } from './person.tsx';
import { personaSlugOf } from '@uw/contracts';
import { formatDate, formatInstant } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import type { AgentsView } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Card } from '@uw/ui/components/card.tsx';
import { commandButton, primaryButton } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { RoutineRow } from '../../agents/routines.ts';
import { capabilityWord } from './agent-words.ts';
import { routineChangePath, routinesPath } from './paths.ts';

export const ROUTINE_NAME_LIMIT = 60;
const DEVICE_LIMIT = 32;

export type RoutineViewer = {
  readonly personId: string | null;
  readonly orgAdmin: boolean;
  readonly switchedOn: boolean;
  readonly holding: Holding;
};

const columns = [
  { key: 'routine', label: 'Routine' },
  { key: 'acts', label: 'Acts as' },
  { key: 'seen', label: 'Last seen' },
  { key: 'claimed', label: 'Items claimed' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Change' },
];

function StatusBadge(props: { readonly routine: RoutineRow }) {
  const { routine } = props;
  if (routine.permissionEnded) return <Badge tone="held">Permission ended</Badge>;
  if (routine.paused) return <Badge tone="neutral">Paused</Badge>;
  return <Badge tone="success">Live</Badge>;
}

function ChangeButton(props: {
  readonly harnessId: string;
  readonly routine: RoutineRow;
  readonly change: 'pause_routine' | 'resume_routine' | 'revoke_routine';
  readonly label: string;
}) {
  const { routine } = props;
  return (
    <form method="post" action={routineChangePath(props.harnessId, routine.id)} class="m-0">
      <input type="hidden" name="change" value={props.change} />
      <button
        type="submit"
        class={commandButton}
        aria-label={`${props.label} the routine ${routine.name}`}
      >
        {props.label}
      </button>
    </form>
  );
}

function Changes(props: { readonly harnessId: string; readonly routine: RoutineRow }) {
  const { harnessId, routine } = props;
  return (
    <div class="flex flex-wrap gap-2">
      {routine.paused ? (
        <ChangeButton
          harnessId={harnessId}
          routine={routine}
          change="resume_routine"
          label="Resume"
        />
      ) : (
        <ChangeButton
          harnessId={harnessId}
          routine={routine}
          change="pause_routine"
          label="Pause"
        />
      )}
      <ChangeButton
        harnessId={harnessId}
        routine={routine}
        change="revoke_routine"
        label="Revoke"
      />
    </div>
  );
}

function rowOf(harnessId: string, viewer: RoutineViewer, routine: RoutineRow) {
  const mine = viewer.personId === routine.personId;
  const owner = shownIdentity(
    `human:${routine.personId}`,
    viewer.holding.names,
    () => routine.ownerName,
  );
  return {
    routine: mine ? (
      `${routine.name} (${routine.device})`
    ) : (
      <span class="inline-flex flex-wrap items-center gap-2">
        <span>{`${routine.name} (${routine.device}) ·`}</span>
        <Who reading={viewer.holding.reading} who={owner} />
      </span>
    ),
    acts: `${personaSlugOf(routine.persona) ?? routine.persona} · ${capabilityWord(routine.capability)}`,
    seen: routine.lastSeenAt === null ? 'Not yet' : formatInstant(routine.lastSeenAt),
    claimed: formatCount(routine.itemsClaimed),
    tokens: `${formatCount(routine.tokens)}, own subscription`,
    status: <StatusBadge routine={routine} />,
    actions: mine || viewer.orgAdmin ? <Changes harnessId={harnessId} routine={routine} /> : null,
  };
}

function visibleRoutines(
  viewer: RoutineViewer,
  routines: readonly RoutineRow[],
): readonly RoutineRow[] {
  if (viewer.orgAdmin) return routines;
  return routines.filter((routine) => routine.personId === viewer.personId);
}

function routineChoices(view: AgentsView, personId: string | null, at: Date) {
  return view.permissions
    .filter((permission) => permission.personId === personId)
    .filter((permission) => permission.capability !== 'none')
    .filter((permission) => permission.expiresAt.getTime() > at.getTime())
    .map((permission) => ({
      value: permission.id,
      label: `${permission.agentTitle ?? permission.persona} · ${capabilityWord(permission.capability)}, until ${formatDate(permission.expiresAt)}`,
    }));
}

function SetupHint(props: { readonly text: string }) {
  return <p class="m-0 border-t border-line px-4 py-3 text-sm text-text-3">{props.text}</p>;
}

const notSwitchedOn =
  'Routines are not switched on here yet: the app has no Cloudflare key for machine logins.';
const grantFirst =
  'To set up a routine, first grant a standing permission above. A routine works under one of your own standing permissions.';

function SetupForm(props: {
  readonly view: AgentsView;
  readonly viewer: RoutineViewer;
  readonly at: Date;
}) {
  const { view, viewer } = props;
  if (!view.admin) return null;
  if (!viewer.switchedOn) return <SetupHint text={notSwitchedOn} />;
  const choices = routineChoices(view, viewer.personId, props.at);
  if (choices.length === 0) return <SetupHint text={grantFirst} />;
  const scope = `routine-${view.harness.id}`;
  return (
    <form
      method="post"
      action={routinesPath(view.harness.id)}
      class="flex flex-col gap-3 border-t border-line px-4 py-3"
    >
      <SelectField name="delegationId" label="Works under" scope={scope} choices={choices} />
      <TextField
        name="name"
        label="Routine name"
        scope={scope}
        required
        maxLength={ROUTINE_NAME_LIMIT}
        placeholder="Hourly builder"
      />
      <TextField
        name="device"
        label="Device"
        scope={scope}
        required
        maxLength={DEVICE_LIMIT}
        placeholder="work-laptop"
        hint="Lowercase letters, numbers and dashes. The machine it runs on."
      />
      <div>
        <button type="submit" class={primaryButton}>
          Set up a routine
        </button>
      </div>
    </form>
  );
}

export function Routines(props: {
  readonly view: AgentsView;
  readonly viewer: RoutineViewer;
  readonly routines: readonly RoutineRow[];
  readonly at: Date;
}) {
  const { view, viewer } = props;
  const shown = visibleRoutines(viewer, props.routines);
  const rows = shown.map((routine) => rowOf(view.harness.id, viewer, routine));
  return (
    <Card
      title="Routines"
      sub="Your own Claude Code or Codex, working this workflow on a timer under a standing permission"
      flush
    >
      {rows.length === 0 ? (
        <p class="m-0 px-4 py-3 text-sm text-text-3">No routines on this workflow yet.</p>
      ) : (
        <Table caption="Routines" columns={columns} rows={rows} bare />
      )}
      <SetupForm view={view} viewer={viewer} at={props.at} />
    </Card>
  );
}
