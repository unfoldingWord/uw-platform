import type { Holding } from './holder.tsx';
import { shownIdentity, Who } from './person.tsx';
import { formatDuration } from '@uw/core/dates';
import type { DraftProblem, DraftStage } from '@uw/contracts';
import type { WorkflowDraftView } from '@uw/harness';
import { Card } from '@uw/ui/components/card.tsx';
import { CommandForm, commandButton, primaryButton } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { DraftMap } from './draft-map.tsx';
import { DraftRow } from './draft-row.tsx';
import { cleanCheck, problemCount } from './draft-words.ts';

const blankStage: DraftStage = {
  id: null,
  key: 'new_stage',
  title: '',
  bracket: 'build_package',
  agentPickup: 'allowed',
  exitGate: 'checks',
  connector: 'none',
  wipLimit: 3,
  instructionsPageId: null,
  validators: [],
  feeds: [],
};

function problemsOf(problems: readonly DraftProblem[], key: string): readonly DraftProblem[] {
  return problems.filter((problem) => problem.stage === key);
}

function Rows(props: { readonly draft: WorkflowDraftView; readonly locked: boolean }) {
  const keys = props.draft.stages.map((stage) => stage.key);
  return (
    <ol data-draft-rows class="m-0 list-none p-0">
      {props.draft.stages.map((stage) => (
        <DraftRow
          stage={stage}
          keys={keys}
          problems={problemsOf(props.draft.problems, stage.key)}
          locked={props.locked}
        />
      ))}
    </ol>
  );
}

function General(props: { readonly draft: WorkflowDraftView }) {
  const keys = new Set(props.draft.stages.map((stage) => stage.key));
  const general = props.draft.problems.filter(
    (problem) => problem.stage === null || !keys.has(problem.stage),
  );
  return (
    <ul data-draft-general class="m-0 flex list-none flex-col gap-1 px-4 pt-3 empty:hidden">
      {general.map((problem) => (
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

function DraftBar(props: { readonly harnessId: string; readonly draft: WorkflowDraftView }) {
  const { draft } = props;
  const clean = draft.problems.length === 0;
  return (
    <div class="flex flex-col gap-3 border-b border-line bg-accent-soft px-4 py-3 text-sm text-accent-text">
      <p class="m-0 font-semibold">
        Draft · only you see these changes until you publish · the live workflow keeps running
      </p>
      <p data-draft-status role="status" aria-live="polite" class="m-0 font-semibold">
        {clean ? cleanCheck : problemCount(draft.problems.length)}
      </p>
      <div class="flex flex-wrap items-end gap-2">
        <button type="button" data-draft-add class={commandButton}>
          Add stage
        </button>
        <CommandForm harnessId={props.harnessId} command="discard_workflow_draft">
          <button type="submit" class={commandButton}>
            Discard
          </button>
        </CommandForm>
        <CommandForm harnessId={props.harnessId} command="publish_workflow_draft">
          <input type="hidden" name="revision" value={String(draft.revision)} data-draft-revision />
          <button
            type="submit"
            data-draft-publish
            aria-disabled={clean ? undefined : 'true'}
            class={primaryButton}
          >
            Publish
          </button>
        </CommandForm>
      </div>
    </div>
  );
}

type Named = { readonly harnessId: string; readonly harnessTitle: string };

function Editor(props: Named & { readonly draft: WorkflowDraftView }) {
  return (
    <section
      data-draft-editor
      data-harness={props.harnessId}
      data-revision={String(props.draft.revision)}
      class="flex min-w-0 flex-col rounded-md border border-line bg-surface text-text"
    >
      <DraftBar harnessId={props.harnessId} draft={props.draft} />
      <DraftMap
        harnessId={props.harnessId}
        harnessTitle={props.harnessTitle}
        stages={props.draft.stages}
        editable
      />
      <General draft={props.draft} />
      <Rows draft={props.draft} locked={false} />
      <template data-draft-template>
        <DraftRow stage={blankStage} keys={[]} problems={[]} locked={false} />
      </template>
    </section>
  );
}

function since(draft: WorkflowDraftView, at: Date): string {
  return formatDuration(at.getTime() - draft.startedAt.getTime());
}

function LockBar(props: { readonly draft: WorkflowDraftView; readonly holding: Holding }) {
  const { draft, holding } = props;
  const { at } = holding.reading;
  const words = draft.lockActive
    ? `is editing this workflow (started ${since(draft, at)} ago). The live workflow is unchanged until they publish.`
    : `started a draft ${since(draft, at)} ago and stopped editing, so their lock has lapsed. The live workflow is unchanged.`;
  const holder = shownIdentity(
    `human:${draft.holder.personId}`,
    holding.names,
    () => draft.holder.name,
  );
  return (
    <div data-lock-bar>
      <Note>
        <Who reading={holding.reading} who={holder} /> {words}
      </Note>
    </div>
  );
}

function EditButton(props: { readonly harnessId: string; readonly label: string }) {
  return (
    <CommandForm harnessId={props.harnessId} command="open_workflow_draft">
      <button type="submit" class={primaryButton}>
        {props.label}
      </button>
    </CommandForm>
  );
}

function TakeOver(props: Named & { readonly draft: WorkflowDraftView }) {
  return (
    <Card title="Their draft" sub="you can watch; to edit, take over the lock with a reason">
      <CommandForm harnessId={props.harnessId} command="take_over_workflow_draft">
        <TextField name="reason" label="Reason" scope={props.harnessId} required maxLength={500} />
        <button type="submit" class={commandButton}>
          Take over
        </button>
      </CommandForm>
      <section data-draft-view class="rounded-md border border-line">
        <DraftMap
          harnessId={props.harnessId}
          harnessTitle={props.harnessTitle}
          stages={props.draft.stages}
          editable={false}
        />
        <Rows draft={props.draft} locked />
      </section>
    </Card>
  );
}

function OthersDraft(
  props: Named & { readonly draft: WorkflowDraftView; readonly holding: Holding },
) {
  const { draft } = props;
  return (
    <div class="flex flex-col gap-3">
      <LockBar draft={draft} holding={props.holding} />
      {draft.admin && draft.lockActive ? (
        <TakeOver harnessId={props.harnessId} harnessTitle={props.harnessTitle} draft={draft} />
      ) : null}
      {draft.admin && !draft.lockActive ? (
        <EditButton harnessId={props.harnessId} label="Pick up their draft" />
      ) : null}
    </div>
  );
}

export function DraftSection(props: {
  readonly harnessId: string;
  readonly harnessTitle: string;
  readonly draft: WorkflowDraftView | null;
  readonly admin: boolean;
  readonly at: Date;
  readonly holding: Holding;
}) {
  const { draft } = props;
  if (draft === null) {
    if (!props.admin) return null;
    return (
      <Card
        title="Change the stages"
        sub="in a draft, checked as you type, live only when you publish"
        actions={<EditButton harnessId={props.harnessId} label="Edit workflow" />}
      >
        <p class="m-0 text-sm text-text-2">
          While you edit, the live workflow keeps running on the stages it has now. Others see that
          you are editing.
        </p>
      </Card>
    );
  }
  if (draft.mine)
    return <Editor harnessId={props.harnessId} harnessTitle={props.harnessTitle} draft={draft} />;
  return (
    <OthersDraft
      harnessId={props.harnessId}
      harnessTitle={props.harnessTitle}
      draft={draft}
      holding={props.holding}
    />
  );
}
