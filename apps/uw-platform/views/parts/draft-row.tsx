import type { Child } from 'hono/jsx';
import type { DraftProblem, DraftStage } from '@uw/contracts';
import { commandButton } from '@uw/ui/components/command-form.tsx';
import { draftChoices, type Choice } from './draft-words.ts';

const control =
  'rounded-md border border-line bg-surface px-3 py-1 text-sm text-text outline-offset-2 outline-accent-text focus-visible:outline-2 disabled:text-text-3';
const loopBox = 'outline-offset-2 outline-accent-text focus-visible:outline-2';
const caption = 'text-xs font-heavy tracking-wide text-text-3 uppercase';

function Field(props: { readonly label: string; readonly children: Child }) {
  return (
    <label class="flex min-w-0 flex-col gap-1">
      <span class={caption}>{props.label}</span>
      {props.children}
    </label>
  );
}

function Pick(props: {
  readonly name: string;
  readonly label: string;
  readonly choices: readonly Choice[];
  readonly selected: string;
  readonly locked: boolean;
}) {
  return (
    <Field label={props.label}>
      <select name={props.name} class={control} disabled={props.locked}>
        {props.choices.map((choice) => (
          <option value={choice.value} selected={choice.value === props.selected}>
            {choice.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function LoopChoices(props: {
  readonly stage: DraftStage;
  readonly keys: readonly string[];
  readonly locked: boolean;
}) {
  const others = props.keys.filter((key) => key !== props.stage.key);
  return (
    <fieldset data-loops class="m-0 flex min-w-0 flex-wrap items-center gap-3 border-0 p-0">
      <legend class={`${caption} mb-1 p-0`}>Loops back to</legend>
      {others.length === 0 ? <span class="text-sm text-text-3">No other stage</span> : null}
      {others.map((key) => (
        <label class="inline-flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            data-loop
            class={loopBox}
            value={key}
            checked={props.stage.feeds.includes(key)}
            disabled={props.locked}
          />
          {key}
        </label>
      ))}
    </fieldset>
  );
}

function RowActions() {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" data-move="up" class={commandButton}>
        Move up
      </button>
      <button type="button" data-move="down" class={commandButton}>
        Move down
      </button>
      <button type="button" data-remove class={commandButton}>
        Remove
      </button>
    </div>
  );
}

function Problems(props: { readonly problems: readonly DraftProblem[] }) {
  return (
    <ul data-problems class="m-0 flex list-none flex-col gap-1 p-0">
      {props.problems.map((problem) => (
        <li
          data-code={problem.code}
          class="rounded-md border border-line-strong bg-raised px-3 py-1 text-sm font-semibold text-text"
        >
          {problem.message}
        </li>
      ))}
    </ul>
  );
}

function picksOf(stage: DraftStage) {
  return [
    { name: 'bracket', label: 'Phase', choices: draftChoices.bracket, selected: stage.bracket },
    {
      name: 'exitGate',
      label: 'Leaves the stage when',
      choices: draftChoices.exitGate,
      selected: stage.exitGate,
    },
    {
      name: 'agentPickup',
      label: 'Who picks up',
      choices: draftChoices.agentPickup,
      selected: stage.agentPickup,
    },
    {
      name: 'connector',
      label: 'Action on leaving',
      choices: draftChoices.connector,
      selected: stage.connector,
    },
  ] as const;
}

function Columns(props: { readonly stage: DraftStage; readonly locked: boolean }) {
  const { stage, locked } = props;
  return (
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Title">
        <input
          type="text"
          name="title"
          value={stage.title}
          maxlength={120}
          class={control}
          disabled={locked}
        />
      </Field>
      {picksOf(stage).map((pick) => (
        <Pick {...pick} locked={locked} />
      ))}
      <Field label="In-progress limit">
        <input
          type="number"
          name="wipLimit"
          min={1}
          max={1000}
          value={String(stage.wipLimit)}
          class={control}
          disabled={locked}
        />
      </Field>
    </div>
  );
}

export function DraftRow(props: {
  readonly stage: DraftStage;
  readonly keys: readonly string[];
  readonly problems: readonly DraftProblem[];
  readonly locked: boolean;
}) {
  const { stage, locked } = props;
  return (
    <li
      data-draft-row
      data-id={stage.id ?? ''}
      data-key={stage.key}
      data-instructions={stage.instructionsPageId ?? ''}
      data-validators={stage.validators.join(',')}
      class="flex min-w-0 flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-heavy text-text">
          {stage.title.trim() === '' ? 'New stage' : stage.title}
        </span>
        <code class="text-xs text-text-3">{stage.key}</code>
        {locked ? null : (
          <span class="ml-auto">
            <RowActions />
          </span>
        )}
      </div>
      <Columns stage={stage} locked={locked} />
      <LoopChoices stage={stage} keys={props.keys} locked={locked} />
      <Problems problems={props.problems} />
    </li>
  );
}
