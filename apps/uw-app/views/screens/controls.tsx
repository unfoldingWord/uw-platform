import type { Context } from 'hono';
import type { Stage } from '@uw/contracts';
import type { OpenDraft, StageControlsView } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Card } from '@uw/ui/components/card.tsx';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { draftChoices, type Choice } from '../parts/draft-words.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { controlsPath, queuePath } from '../parts/paths.ts';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';

const RULES_FORM = 'stage-rules';

const control =
  'rounded-md border border-line bg-surface px-2 py-1 text-sm text-text outline-offset-2 outline-accent-text focus-visible:outline-2 disabled:text-text-3';
const box = 'outline-offset-2 outline-accent-text focus-visible:outline-2';
const head = 'px-3 py-2 text-left text-xs font-semibold tracking-wide text-text-3 uppercase';
const cell = 'border-t border-line px-3 py-2 align-top';
const primary =
  'inline-flex items-center rounded-md border border-accent bg-accent px-3 py-1 text-sm font-heavy text-on-accent outline-offset-2 outline-accent-text focus-visible:outline-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

type Editing = { readonly admin: boolean };

function linked(props: Editing): Record<string, string> {
  return props.admin ? { form: RULES_FORM } : {};
}

function Pick(props: {
  readonly name: string;
  readonly label: string;
  readonly choices: readonly Choice[];
  readonly selected: string;
  readonly admin: boolean;
}) {
  return (
    <select
      name={props.name}
      aria-label={props.label}
      class={control}
      disabled={!props.admin}
      {...linked(props)}
    >
      {props.choices.map((choice) => (
        <option value={choice.value} selected={choice.value === props.selected}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

function pageChoices(view: StageControlsView): readonly Choice[] {
  return [
    { value: '', label: 'None' },
    ...view.skillPages.map((page) => ({ value: page.id, label: page.title })),
  ];
}

function Checks(props: {
  readonly view: StageControlsView;
  readonly stage: Stage;
  readonly index: number;
}) {
  const { view, stage, index } = props;
  const names = [...new Set([...view.validators, ...stage.validators])];
  if (names.length === 0) return <span class="text-sm text-text-3">None registered</span>;
  return (
    <fieldset class="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend class="sr-only">{`Checks run on ${stage.title}`}</legend>
      {names.map((name) => (
        <label class="inline-flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            name={`stage.${index}.validator.${name}`}
            value={name}
            class={box}
            checked={stage.validators.includes(name)}
            disabled={!view.admin}
            {...linked(view)}
          />
          {name}
        </label>
      ))}
    </fieldset>
  );
}

function PauseCell(props: { readonly view: StageControlsView; readonly stage: Stage }) {
  const { view, stage } = props;
  const state = stage.paused ? (
    <Badge tone="held">Paused</Badge>
  ) : (
    <Badge tone="success">Running</Badge>
  );
  if (!view.admin) return state;
  const command = stage.paused ? 'resume' : 'pause';
  return (
    <div class="flex flex-col items-start gap-1">
      {state}
      <CommandForm harnessId={view.harness.id} command={command} itemId={stage.id}>
        <input type="hidden" name="stageKey" value={stage.key} />
        <button
          type="submit"
          class={commandButton}
          aria-label={`${stage.paused ? 'Resume' : 'Pause'} ${stage.title}`}
        >
          {stage.paused ? 'Resume' : 'Pause'}
        </button>
      </CommandForm>
    </div>
  );
}

type RowProps = {
  readonly view: StageControlsView;
  readonly stage: Stage;
  readonly index: number;
};

function ExitCell(props: RowProps) {
  const { view, stage, index } = props;
  const name = (field: string) => `stage.${index}.${field}`;
  const merges = stage.connector !== 'none';
  return (
    <td class={cell}>
      <Pick
        name={name('exitGate')}
        label={`To leave ${stage.title}`}
        choices={draftChoices.exitGate}
        selected={stage.exitGate}
        admin={view.admin}
      />
      {merges ? (
        <p class="m-0 mt-1 text-xs text-text-3">Acts outside the platform, so a person approves.</p>
      ) : null}
    </td>
  );
}

function LimitCell(props: RowProps) {
  const { view, stage, index } = props;
  const name = (field: string) => `stage.${index}.${field}`;
  return (
    <td class={cell}>
      <input
        type="number"
        name={name('wipLimit')}
        aria-label={`Most at once on ${stage.title}`}
        min="1"
        max="1000"
        value={String(stage.wipLimit)}
        class={`${control} w-8 tabular-nums`}
        disabled={!view.admin}
        {...linked(view)}
      />
    </td>
  );
}

function RuleRow(props: {
  readonly view: StageControlsView;
  readonly stage: Stage;
  readonly index: number;
}) {
  const { view, stage, index } = props;
  const name = (field: string) => `stage.${index}.${field}`;
  return (
    <tr>
      <th scope="row" class={`${cell} text-left text-sm font-heavy text-text`}>
        {stage.title}
        {view.admin ? (
          <input type="hidden" name={name('id')} value={stage.id} form={RULES_FORM} />
        ) : null}
      </th>
      <td class={cell}>
        <Pick
          name={name('agentPickup')}
          label={`Agents pick up on ${stage.title}`}
          choices={draftChoices.agentPickup}
          selected={stage.agentPickup}
          admin={view.admin}
        />
      </td>
      <ExitCell view={view} stage={stage} index={index} />
      <LimitCell view={view} stage={stage} index={index} />
      <td class={cell}>
        <Pick
          name={name('instructionsPageId')}
          label={`Instructions for ${stage.title}`}
          choices={pageChoices(view)}
          selected={stage.instructionsPageId ?? ''}
          admin={view.admin}
        />
      </td>
      <td class={cell}>
        <Checks view={view} stage={stage} index={index} />
      </td>
      <td class={cell}>
        <PauseCell view={view} stage={stage} />
      </td>
    </tr>
  );
}

const ruleColumns = [
  'Stage',
  'Agents pick up',
  'To leave the stage',
  'Most at once',
  'Instructions',
  'Checks run',
  'Running',
];

function RulesTable(props: { readonly view: StageControlsView }) {
  return (
    <table class="w-full border-collapse">
      <caption class="sr-only">Stage rules</caption>
      <thead>
        <tr>
          {ruleColumns.map((label) => (
            <th scope="col" class={head}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.view.stages.map((stage, index) => (
          <RuleRow view={props.view} stage={stage} index={index} />
        ))}
      </tbody>
    </table>
  );
}

function SaveRules(props: { readonly view: StageControlsView }) {
  const blocked = props.view.draft !== null;
  return (
    <div class="border-t border-line px-4 py-3">
      <form
        id={RULES_FORM}
        data-command="set_stage_rules"
        data-harness={props.view.harness.id}
        method="post"
        action="#"
        class="flex flex-wrap items-center gap-3"
      >
        <button type="submit" class={primary} aria-disabled={blocked ? 'true' : undefined}>
          Save changes
        </button>
        <p data-outcome role="status" aria-live="polite" class="m-0 text-sm text-text-3"></p>
      </form>
    </div>
  );
}

function StageRules(props: { readonly view: StageControlsView }) {
  const { view } = props;
  return (
    <Card title="Stage rules" sub="Applies to everyone on this workflow" flush>
      <RulesTable view={view} />
      {view.admin ? <SaveRules view={view} /> : null}
      <p class="m-0 border-t border-line px-4 py-3 text-sm text-text-3">
        Adding, removing or reordering stages, and loops between them, happen in Flow. “A person
        approves” means an agent can finish its work but never moves the item on.
      </p>
    </Card>
  );
}

type Switch = {
  readonly key: 'builder' | 'shadow' | 'freeze';
  readonly command: string;
  readonly field: string;
  readonly title: string;
  readonly about: string;
  readonly on: boolean;
};

function switchesOf(view: StageControlsView): readonly Switch[] {
  const { harness } = view;
  return [
    {
      key: 'builder',
      command: 'set_hosted_builder',
      field: 'enabled',
      title: 'Builder runs on the platform',
      about:
        "Off: coding is done in people's own Claude Code. On: Builder codes in a sandbox, paid from the shared cap.",
      on: harness.hostedBuilderEnabled,
    },
    {
      key: 'shadow',
      command: 'set_shadow',
      field: 'shadow',
      title: 'Shadow mode',
      about:
        'The ship rule is checked and recorded on every change, but nothing is posted to GitHub and no connector runs.',
      on: harness.shadow,
    },
    {
      key: 'freeze',
      command: 'set_freeze',
      field: 'frozen',
      title: 'Freeze this workflow',
      about: "Nothing new is claimed or merged until it's unfrozen.",
      on: harness.frozen,
    },
  ];
}

const switchButton =
  'inline-flex min-w-8 items-center justify-center rounded-md border px-3 py-1 text-sm font-heavy outline-offset-2 outline-accent-text focus-visible:outline-2 disabled:cursor-not-allowed aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent border-line bg-surface text-text-3';

function SwitchButton(props: { readonly item: Switch; readonly admin: boolean }) {
  const { item } = props;
  return (
    <button
      type={props.admin ? 'submit' : 'button'}
      data-switch={item.key}
      aria-pressed={item.on ? 'true' : 'false'}
      aria-label={`${item.title}: ${item.on ? 'on' : 'off'}`}
      class={switchButton}
      disabled={!props.admin}
    >
      {item.on ? 'On' : 'Off'}
    </button>
  );
}

function SwitchRow(props: { readonly view: StageControlsView; readonly item: Switch }) {
  const { view, item } = props;
  const words = (
    <div class="min-w-0 flex-1">
      <p class="m-0 text-sm font-heavy text-text">{item.title}</p>
      <p class="m-0 text-sm text-text-3">{item.about}</p>
    </div>
  );
  return (
    <li class="flex flex-wrap items-start gap-3 border-t border-line px-4 py-3 first:border-t-0">
      {view.admin ? (
        <CommandForm harnessId={view.harness.id} command={item.command}>
          <input type="hidden" name={item.field} value={item.on ? 'false' : 'true'} />
          <SwitchButton item={item} admin />
        </CommandForm>
      ) : (
        <SwitchButton item={item} admin={false} />
      )}
      {words}
    </li>
  );
}

function Switches(props: { readonly view: StageControlsView }) {
  return (
    <Card title="Workflow switches" sub="Apply to everyone on this workflow" flush>
      <ul class="m-0 list-none p-0">
        {switchesOf(props.view).map((item) => (
          <SwitchRow view={props.view} item={item} />
        ))}
      </ul>
    </Card>
  );
}

function Access(props: { readonly view: StageControlsView }) {
  const { view } = props;
  if (view.admin)
    return (
      <p class="m-0">
        <Badge tone="info">You can edit · area admin</Badge>
      </p>
    );
  return (
    <div class="flex flex-wrap items-center gap-3">
      <Badge tone="neutral">View only</Badge>
      <p class="m-0 text-sm font-semibold text-text-3">
        {`Only admins of ${view.harness.jdArea} can change this.`}
      </p>
    </div>
  );
}

function DraftNote(props: { readonly draft: OpenDraft | null }) {
  if (props.draft === null) return null;
  return (
    <Note>
      {`A draft of this workflow is open in Flow, started by ${props.draft.name}. Stage rules can be saved here once it is published or discarded.`}
    </Note>
  );
}

export async function controlsScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  if (harnessId === null) return notFound(c);
  const read = { at: screen.at };
  const outcome = await screen.kernel.views.stageControls(screen.caller, { harnessId }, read);
  if (outcome.status !== 'accepted') return notFound(c);
  const view = outcome.value;
  const cursor = await screen.kernel.views.cursor(screen.caller, { harnessId }, read);
  const spec = {
    title: `${view.harness.title} ${pageNames.controls}`,
    current: controlsPath(harnessId),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(view.harness.title, queuePath(harnessId), pageNames.controls),
    tabs: workflowTabs(harnessId, 'controls', await waitingCount(screen, harnessId)),
    live: { screen: 'flow' as const, harnesses: [{ harnessId, cursor }] },
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow={`Workflow · ${view.harness.template} template`}
        title={view.harness.title}
        lede="The rules each stage follows and the switches for the whole workflow."
      />
      <div class="flex flex-col gap-5">
        <Access view={view} />
        <DraftNote draft={view.draft} />
        <StageRules view={view} />
        <Switches view={view} />
      </div>
    </>,
  );
}
