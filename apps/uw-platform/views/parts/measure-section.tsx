import type { Child } from 'hono/jsx';
import type { ErrorReason } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { can } from '@uw/core/acl';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { activatable } from '../../measures/activations.ts';
import { measureStateFor, type MeasureState } from '../../measures/measure-state.ts';
import { readableDashboard } from '../../measures/previews.ts';
import { reportCardSection } from './dashboard-panels.tsx';
import type { ScreenKernel } from './frame.tsx';
import { awaitingOf, pausedOf, reasonOf, runKindOf, runStateOf } from './measure-words.ts';
import { pageLink } from './page-shown.ts';
import { measureJsonPath } from './paths.ts';

const ENDPOINT = '/api/measures/commands';
const PACKAGE_INDEX = 'pypi.org and files.pythonhosted.org, while it installs';

type Page = { readonly id: string; readonly type: string; readonly status: string };

function trialRefusal(state: MeasureState): ErrorReason | null {
  if (!state.admin) return 'not_permitted';
  return state.measure.status === 'suggested' ? null : 'transition_not_allowed';
}

function activateRefusal(state: MeasureState): ErrorReason | null {
  if (!state.admin) return 'not_permitted';
  if (!activatable(state.measure.status, state.activation)) return 'transition_not_allowed';
  return state.awaiting === 'trial' ? 'trial_required' : null;
}

function runNowRefusal(state: MeasureState): ErrorReason | null {
  if (!state.editor) return 'not_permitted';
  if (state.activation === null) return 'activation_required';
  return state.activation.pausedReason === null ? null : 'measure_paused';
}

function Control(props: {
  readonly state: MeasureState;
  readonly command: string;
  readonly label: string;
  readonly refusal: ErrorReason | null;
  readonly children?: Child;
}) {
  const { measure } = props.state;
  return (
    <PlatformCommandForm endpoint={ENDPOINT} command={props.command} scope={measure.id} inline>
      <input type="hidden" name="measureId" value={measure.id} />
      <input type="hidden" name="expectedVersion" value={String(measure.version)} />
      {props.children}
      <HumanActionButton
        itemId={measure.id}
        label={props.label}
        name="command"
        value={props.command}
        disabledReason={props.refusal}
      />
    </PlatformCommandForm>
  );
}

function OfferedDashboards(props: { readonly state: MeasureState }) {
  const { dashboards } = props.state;
  if (dashboards.length === 0) return null;
  return (
    <fieldset class="m-0 flex w-full flex-col gap-1 border-0 p-0">
      <legend class="mb-1 p-0 text-sm text-text-2">Make these dashboards active too</legend>
      {dashboards.map((dashboard) => (
        <label class="flex min-h-size-5 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            name={`dashboard.${dashboard.id}`}
            value={dashboard.id}
            checked
            class="rounded-sm outline-offset-2 outline-accent-text focus-visible:outline-2"
          />
          {dashboard.title}
        </label>
      ))}
    </fieldset>
  );
}

function Controls(props: { readonly state: MeasureState }) {
  const { state } = props;
  return (
    <div data-pdf-hidden="" class="flex flex-col gap-3">
      <Control
        state={state}
        command="run_measure_trial"
        label="Run trial"
        refusal={trialRefusal(state)}
      />
      <Control
        state={state}
        command="activate_measure"
        label="Activate"
        refusal={activateRefusal(state)}
      >
        <OfferedDashboards state={state} />
      </Control>
      <Control
        state={state}
        command="run_measure_now"
        label="Run now"
        refusal={runNowRefusal(state)}
      />
    </div>
  );
}

function stateLines(state: MeasureState): string[] {
  const { measure, activation } = state;
  const schedule = measure.measure.schedule;
  const every =
    schedule.every === 'day'
      ? 'every day'
      : schedule.every === 'week'
        ? 'every week'
        : `every month on day ${String(schedule.day)}`;
  return [
    `${awaitingOf(state.awaiting)}.`,
    ...(activation?.pausedReason === null || activation === null
      ? []
      : [pausedOf(activation.pausedReason)]),
    `Runs ${every}, as ${measure.measure.runtime} package ${measure.measure.package}.`,
    `It may reach the host of the resource it measures and that host with or without www., and ${PACKAGE_INDEX}. Every other host is refused.`,
  ];
}

function Commands(props: { readonly state: MeasureState }) {
  const columns = [
    { key: 'resource', label: 'Resource' },
    { key: 'command', label: 'Command' },
    { key: 'host', label: 'Hosts it may reach' },
  ];
  const rows = props.state.commands.map((each) => ({
    resource: each.title,
    command: <code class="font-mono text-xs">{each.command.join(' ')}</code>,
    host: each.hosts.length === 0 ? 'No address' : each.hosts.join(' and '),
  }));
  if (rows.length === 0)
    return <p class="m-0 text-sm text-text-3">No resource you can read is in its view yet.</p>;
  return <Table caption="The command run for each resource" columns={columns} rows={rows} />;
}

function LatestRun(props: { readonly state: MeasureState }) {
  const run = props.state.latestRun;
  if (run === null) return <p class="m-0 text-sm text-text-3">It has not run yet.</p>;
  const columns = [
    { key: 'resource', label: 'Resource' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'version', label: 'Tool version' },
  ];
  const rows = props.state.runObservations.map((each) => ({
    resource: each.title,
    outcome: each.reason === null ? 'Read' : `Not read: ${reasonOf(each.reason)}`,
    version: each.toolVersion ?? 'Unknown',
  }));
  return (
    <>
      <p class="m-0 text-sm text-text">{`${runKindOf(run.kind)}: ${runStateOf(run.state)}.`}</p>
      {props.state.refusedHosts.length === 0 ? null : (
        <p class="m-0 text-sm text-text">{`Refused hosts: ${props.state.refusedHosts.join(', ')}.`}</p>
      )}
      {rows.length === 0 ? null : (
        <Table
          caption="Outcome for each resource in the latest run"
          columns={columns}
          rows={rows}
        />
      )}
    </>
  );
}

function MeasureSection(props: { readonly state: MeasureState }) {
  const { state } = props;
  return (
    <Section
      title="Measure"
      headingId="measure-state-heading"
      attrs={{ 'data-measure': state.measure.id }}
    >
      <ul class="m-0 flex flex-col gap-1 pl-5 text-sm text-text">
        {stateLines(state).map((line) => (
          <li>{line}</li>
        ))}
      </ul>
      <Controls state={state} />
      <Commands state={state} />
      <LatestRun state={state} />
      <p data-pdf-hidden="" class="m-0 text-sm">
        <a href={measureJsonPath(state.measure.id)} class={pageLink}>
          Its observations as JSON
        </a>
      </p>
    </Section>
  );
}

async function dashboardControls(db: Executor, screen: ScreenKernel, page: Page): Promise<Child> {
  const reader = { db, actor: screen.caller.actor, at: screen.at };
  const dashboard = await readableDashboard(reader, page.id);
  if (dashboard === null || dashboard.status !== 'suggested') return null;
  const area = { kind: 'area', area: dashboard.jdArea } as const;
  const editor = reader.actor.kind === 'person' && can(reader.actor, 'write', area, reader.at);
  return (
    <PlatformCommandForm
      endpoint={ENDPOINT}
      command="activate_dashboard"
      scope={dashboard.id}
      inline
    >
      <input type="hidden" name="dashboardId" value={dashboard.id} />
      <input type="hidden" name="expectedVersion" value={String(dashboard.version)} />
      <HumanActionButton
        itemId={dashboard.id}
        label="Make this dashboard active"
        name="command"
        value="activate_dashboard"
        disabledReason={editor ? null : 'not_permitted'}
      />
    </PlatformCommandForm>
  );
}

async function typedPart(db: Executor, screen: ScreenKernel, page: Page): Promise<Child> {
  if (page.type === 'dashboard') return dashboardControls(db, screen, page);
  if (page.type !== 'measure') return null;
  const state = await measureStateFor(db, screen.caller.actor, page.id, screen.at);
  return state === null ? null : <MeasureSection state={state} />;
}

export async function measureParts(db: Executor, screen: ScreenKernel, page: Page): Promise<Child> {
  return (
    <>
      {await typedPart(db, screen, page)}
      {await reportCardSection(db, screen, page.id)}
    </>
  );
}
