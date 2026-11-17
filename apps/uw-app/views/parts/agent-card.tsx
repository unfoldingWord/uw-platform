import { engineSchema, runShapeSchema } from '@uw/contracts';
import { formatMoney } from '@uw/core/money';
import type { ActivationCheck, PersonaDashboard } from '@uw/harness';
import { Card } from '@uw/ui/components/card.tsx';
import { commandButton, primaryButton } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { SegmentedControl } from '@uw/ui/components/segmented-control.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import {
  actionGroups,
  checkWords,
  engineWord,
  lockedActions,
  notBuiltActions,
  otherServedActions,
  runShapeWord,
  type ActionWords,
} from './agent-words.ts';
import { personaPath } from './paths.ts';
import { ActivateForm, type SavedToolset } from './persona-controls.tsx';

const box = 'mt-1 outline-offset-2 outline-accent-text focus-visible:outline-2';
const groupTitle = 'm-0 mb-1 text-xs font-heavy tracking-wide text-text-3 uppercase';

function Action(props: {
  readonly words: ActionWords;
  readonly held: boolean;
  readonly offered: boolean;
}) {
  const { words } = props;
  return (
    <label class="flex items-start gap-2 py-1 text-sm">
      <input
        type="checkbox"
        name="verb"
        value={words.name}
        checked={props.held}
        disabled={!props.offered}
        class={box}
      />
      <span class="flex min-w-0 flex-col">
        <span class="font-semibold text-text">{words.label}</span>
        {words.detail === '' ? null : <span class="text-xs text-text-3">{words.detail}</span>}
      </span>
    </label>
  );
}

function Unavailable(props: {
  readonly label: string;
  readonly why: string;
  readonly struck: boolean;
}) {
  return (
    <label class="flex items-start gap-2 py-1 text-sm opacity-70">
      <input type="checkbox" disabled class={box} />
      <span class="flex min-w-0 flex-col">
        <span class={`font-semibold text-text ${props.struck ? 'line-through' : ''}`}>
          {props.label}
        </span>
        <span class="text-xs text-text-3">{props.why}</span>
      </span>
    </label>
  );
}

function Actions(props: { readonly dashboard: PersonaDashboard }) {
  const { dashboard } = props;
  const held = new Set(dashboard.toolset);
  const offered = new Set<string>(dashboard.canEdit ? (dashboard.toolsetOptions ?? []) : []);
  const groups = [...actionGroups, { title: 'Other', actions: otherServedActions() }];
  return (
    <fieldset class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend class="mb-1 p-0 text-md font-heavy text-text">Actions it may take</legend>
      <p class="m-0 text-sm text-text-3">
        Its keyring. An action not ticked here is impossible for it, whatever its instructions say.
      </p>
      {groups
        .filter((group) => group.actions.length > 0)
        .map((group) => (
          <div>
            <p class={groupTitle}>{group.title}</p>
            {group.actions.map((words) => (
              <Action words={words} held={held.has(words.name)} offered={offered.has(words.name)} />
            ))}
          </div>
        ))}
      <div>
        <p class={groupTitle}>Not available yet</p>
        {notBuiltActions().map((words) => (
          <Unavailable
            label={words.label}
            why="Not available yet: its module isn't built."
            struck={false}
          />
        ))}
      </div>
      <div>
        <p class={groupTitle}>Locked</p>
        {lockedActions.map((name) => (
          <Unavailable label={name} why="Locked: never available to any agent." struck />
        ))}
      </div>
    </fieldset>
  );
}

function dollars(minor: number): string {
  const cents = String(minor % 100).padStart(2, '0');
  return `${Math.floor(minor / 100)}.${cents}`;
}

function RunsOn(props: { readonly dashboard: PersonaDashboard }) {
  const { frontmatter } = props.dashboard;
  return (
    <div class="flex flex-col gap-1">
      <p class={groupTitle}>Runs on</p>
      <SegmentedControl
        name="run_shape"
        legend="Runs on"
        selected={frontmatter.run_shape}
        choices={runShapeSchema.options.map((shape) => ({
          value: shape,
          label: runShapeWord(shape),
        }))}
      />
      <p class="m-0 text-xs text-text-3">
        Platform runs are paid from the shared cap. Runs on people's own Claude Code use their
        subscription.
      </p>
    </div>
  );
}

function Settings(props: { readonly dashboard: PersonaDashboard }) {
  const { dashboard } = props;
  const { frontmatter } = dashboard;
  const scope = dashboard.page.id;
  return (
    <div class="flex min-w-0 flex-col gap-4">
      <RunsOn dashboard={dashboard} />
      <SelectField
        name="engine"
        label="Engine"
        scope={scope}
        selected={frontmatter.engine}
        choices={engineSchema.options.map((engine) => ({
          value: engine,
          label: engineWord(engine),
        }))}
      />
      <TextField
        name="model"
        label="Model"
        scope={scope}
        value={frontmatter.model}
        maxLength={200}
      />
      <TextField
        name="budget"
        label="Monthly budget (US dollars)"
        scope={scope}
        value={dollars(frontmatter.budget.monthly_minor)}
        maxLength={12}
        hint={`Now ${formatMoney({ amountMinor: frontmatter.budget.monthly_minor, currency: 'USD' })} a month.`}
      />
      <TextAreaField
        name="bodyMd"
        label="Instructions"
        scope={scope}
        value={dashboard.bodyMd}
        rows={10}
        maxLength={100_000}
        hint="The agent page's text. Each stage's own instructions are added when a run reads its item."
      />
    </div>
  );
}

function Outcome(props: { readonly saved: SavedToolset | null }) {
  const { saved } = props;
  if (saved === null) return <p role="status" class="m-0 text-sm text-text-3"></p>;
  if ('accepted' in saved) return <Note>Saved. The checks below have run again.</Note>;
  return (
    <p role="status" class="m-0 text-sm text-text-3">
      {reasonText(saved.reason)}
    </p>
  );
}

function Buttons(props: {
  readonly dashboard: PersonaDashboard;
  readonly saved: SavedToolset | null;
}) {
  const { dashboard } = props;
  if (!dashboard.canEdit) return <Outcome saved={props.saved} />;
  return (
    <div class="flex flex-wrap items-center gap-3 border-t border-line pt-3">
      <button type="submit" class={primaryButton}>
        Save and re-check
      </button>
      {dashboard.page.status === 'retired' ? null : (
        <button type="submit" name="retire" value="retire" class={commandButton}>
          Retire
        </button>
      )}
      <Outcome saved={props.saved} />
    </div>
  );
}

export function JobCard(props: {
  readonly dashboard: PersonaDashboard;
  readonly requestId: string;
  readonly saved: SavedToolset | null;
}) {
  const { dashboard } = props;
  const { page } = dashboard;
  return (
    <Card title="Job card">
      {dashboard.canEdit ? null : (
        <Note>
          {`Only admins of area ${dashboard.harness.jdArea} can change an agent. You can see what it may do.`}
        </Note>
      )}
      <form method="post" action={`${personaPath(page.id)}/toolset`} class="flex flex-col gap-4">
        <input type="hidden" name="expectedVersion" value={String(page.version)} />
        <input type="hidden" name="requestId" value={props.requestId} />
        <fieldset
          disabled={!dashboard.canEdit}
          class="m-0 grid min-w-0 grid-cols-1 gap-6 border-0 p-0 lg:grid-cols-2"
        >
          <legend class="sr-only">{`What ${page.title} may do`}</legend>
          <Actions dashboard={dashboard} />
          <Settings dashboard={dashboard} />
        </fieldset>
        {page.status === 'active' && dashboard.canEdit ? (
          <p class="m-0 text-sm text-text-3">
            Saving a change takes it out of service until it's put live again.
          </p>
        ) : null}
        <Buttons dashboard={dashboard} saved={props.saved} />
      </form>
    </Card>
  );
}

function CheckRow(props: { readonly check: ActivationCheck }) {
  const { check } = props;
  const mark = check.passed === null ? '–' : check.passed ? '✓' : '✗';
  const tone = check.passed === null ? 'text-text-3' : check.passed ? 'text-ok-text' : 'text-text';
  return (
    <li
      class="flex items-start gap-2 text-sm"
      data-check={check.key}
      data-passed={String(check.passed)}
    >
      <span class={`font-heavy ${tone}`} aria-hidden="true">
        {mark}
      </span>
      <span class="flex min-w-0 flex-col">
        <span class="text-text">{checkWords[check.key]}</span>
        {check.passed === false && check.message !== null ? (
          <span class="text-xs text-text-3">{check.message}</span>
        ) : null}
        {check.passed === null ? (
          <span class="text-xs text-text-3">Checked when an admin puts it live.</span>
        ) : null}
      </span>
    </li>
  );
}

export function Checks(props: { readonly dashboard: PersonaDashboard }) {
  const { dashboard } = props;
  return (
    <Card title="Checks before it goes live" sub="Run again every time you open or save it">
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        {dashboard.checks.map((check) => (
          <CheckRow check={check} />
        ))}
      </ul>
      {dashboard.canActivate ? <ActivateForm dashboard={dashboard} /> : null}
    </Card>
  );
}
