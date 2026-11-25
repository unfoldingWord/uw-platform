import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { Stage } from '@uw/contracts';
import type { OpenDraft, StageControlsView } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Button } from '@uw/ui/components/button.tsx';
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { fieldControl } from '@uw/ui/components/field.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { domId } from '@uw/ui/components/text.ts';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import type { AppEnv } from '../../deps.ts';
import { draftChoices, type Choice } from '../parts/draft-words.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { controlsPath, queuePath } from '../parts/paths.ts';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';
import { InstructionsExtras } from '../parts/stage-instructions.tsx';

const RULES_COMMAND = 'set_stage_rules';

const control = `${fieldControl} disabled:text-text-3`;
const box = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function rulesFormId(harnessId: string): string {
  return domId('form', RULES_COMMAND, harnessId);
}

function linked(view: StageControlsView): Record<string, string> {
  return view.admin ? { form: rulesFormId(view.harness.id) } : {};
}

type RowProps = {
  readonly view: StageControlsView;
  readonly stage: Stage;
  readonly index: number;
};

const fieldName = (index: number, field: string): string => `stage.${index}.${field}`;

function Pick(props: {
  readonly view: StageControlsView;
  readonly name: string;
  readonly label: string;
  readonly choices: readonly Choice[];
  readonly selected: string;
}) {
  return (
    <select
      name={props.name}
      aria-label={props.label}
      class={control}
      disabled={!props.view.admin}
      {...linked(props.view)}
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

function StageName(props: RowProps) {
  const { view, stage, index } = props;
  return (
    <span class="font-semibold text-text">
      {stage.title}
      {view.admin ? (
        <input type="hidden" name={fieldName(index, 'id')} value={stage.id} {...linked(view)} />
      ) : null}
    </span>
  );
}

function ExitRule(props: RowProps) {
  const { view, stage, index } = props;
  return (
    <div class="flex flex-col gap-1">
      <Pick
        view={view}
        name={fieldName(index, 'exitGate')}
        label={`To leave ${stage.title}`}
        choices={draftChoices.exitGate}
        selected={stage.exitGate}
      />
      {stage.connector === 'none' ? null : (
        <span class="text-xs text-text-3">Acts outside the platform, so a person approves.</span>
      )}
    </div>
  );
}

function Limit(props: RowProps) {
  const { view, stage, index } = props;
  return (
    <input
      type="number"
      name={fieldName(index, 'wipLimit')}
      aria-label={`Most at once on ${stage.title}`}
      min="1"
      max="1000"
      value={String(stage.wipLimit)}
      class={`${control} w-8 tabular-nums`}
      disabled={!view.admin}
      {...linked(view)}
    />
  );
}

function Checks(props: RowProps) {
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
            name={fieldName(index, `validator.${name}`)}
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

function Running(props: RowProps) {
  const { view, stage } = props;
  const state = stage.paused ? (
    <Badge tone="held">Paused</Badge>
  ) : (
    <Badge tone="success">Running</Badge>
  );
  if (!view.admin) return state;
  const verb = stage.paused ? 'Resume' : 'Pause';
  return (
    <div class="flex flex-col items-start gap-1">
      {state}
      <CommandForm harnessId={view.harness.id} command={verb.toLowerCase()} itemId={stage.id}>
        <input type="hidden" name="stageKey" value={stage.key} />
        <Button type="submit" size="sm" label={`${verb} ${stage.title}`}>
          {verb}
        </Button>
      </CommandForm>
    </div>
  );
}

const ruleColumns = [
  { key: 'stage', label: 'Stage' },
  { key: 'pickup', label: 'Agents pick up' },
  { key: 'exit', label: 'To leave the stage' },
  { key: 'limit', label: 'Most at once' },
];

const extraColumns = [
  { key: 'name', label: 'Stage' },
  { key: 'instructions', label: 'Instructions' },
  { key: 'checks', label: 'Checks run' },
  { key: 'running', label: 'Running' },
];

function ruleRow(props: RowProps): Readonly<Record<string, Child>> {
  const { view, stage, index } = props;
  return {
    stage: <StageName {...props} />,
    name: <span class="font-semibold text-text">{stage.title}</span>,
    pickup: (
      <Pick
        view={view}
        name={fieldName(index, 'agentPickup')}
        label={`Agents pick up on ${stage.title}`}
        choices={draftChoices.agentPickup}
        selected={stage.agentPickup}
      />
    ),
    exit: <ExitRule {...props} />,
    limit: <Limit {...props} />,
    instructions: (
      <div class="flex flex-col gap-2">
        <Pick
          view={view}
          name={fieldName(index, 'instructionsPageId')}
          label={`Instructions for ${stage.title}`}
          choices={pageChoices(view)}
          selected={stage.instructionsPageId ?? ''}
        />
        <InstructionsExtras view={view} stage={stage} />
      </div>
    ),
    checks: <Checks {...props} />,
    running: <Running {...props} />,
  };
}

function SaveRules(props: { readonly view: StageControlsView }) {
  const blocked = props.view.draft !== null;
  return (
    <div class="flex justify-end">
      <CommandForm harnessId={props.view.harness.id} command={RULES_COMMAND}>
        <Button
          type="submit"
          variant="human"
          attrs={{ 'aria-disabled': blocked ? 'true' : undefined }}
        >
          Save changes
        </Button>
      </CommandForm>
    </div>
  );
}

function StageRules(props: { readonly view: StageControlsView }) {
  const { view } = props;
  const rows = view.stages.map((stage, index) => ruleRow({ view, stage, index }));
  return (
    <Section title="Stage rules" sub="Applies to everyone on this workflow">
      <Table caption="Stage rules" columns={ruleColumns} rows={rows} bare />
      <Table caption="Stage instructions and checks" columns={extraColumns} rows={rows} bare />
      {view.admin ? <SaveRules view={view} /> : null}
      <p class="m-0 text-sm text-text-3">
        Adding, removing or reordering stages, and loops between them, happen in Flow. “A person
        approves” means an agent can finish its work but never moves the item on.
      </p>
    </Section>
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

function SwitchState(props: { readonly item: Switch }) {
  return (
    <span data-switch={props.item.key} data-state={props.item.on ? 'on' : 'off'}>
      <Badge tone={props.item.on ? 'info' : 'neutral'}>{props.item.on ? 'On' : 'Off'}</Badge>
    </span>
  );
}

function SwitchToggle(props: { readonly view: StageControlsView; readonly item: Switch }) {
  const { view, item } = props;
  if (!view.admin) return null;
  return (
    <CommandForm harnessId={view.harness.id} command={item.command}>
      <input type="hidden" name={item.field} value={item.on ? 'false' : 'true'} />
      <Button type="submit" size="sm" label={`${item.on ? 'Turn off' : 'Turn on'}: ${item.title}`}>
        {item.on ? 'Turn off' : 'Turn on'}
      </Button>
    </CommandForm>
  );
}

function Switches(props: { readonly view: StageControlsView }) {
  return (
    <Section title="Workflow switches" sub="Apply to everyone on this workflow">
      <RowList label="Workflow switches">
        {switchesOf(props.view).map((item) => (
          <ListRow
            lead={<SwitchState item={item} />}
            title={item.title}
            meta={item.about}
            trail={<SwitchToggle view={props.view} item={item} />}
          />
        ))}
      </RowList>
    </Section>
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
    <DocumentShape
      head={{
        eyebrow: `Workflow · ${view.harness.template} template`,
        title: view.harness.title,
        lede: 'The rules each stage follows and the switches for the whole workflow.',
      }}
    >
      <Access view={view} />
      <DraftNote draft={view.draft} />
      <StageRules view={view} />
      <Switches view={view} />
    </DocumentShape>,
  );
}
