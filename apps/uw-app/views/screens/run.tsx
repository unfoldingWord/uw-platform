import type { Context } from 'hono';
import type { RunStepRecord } from '@uw/contracts';
import type { RunSummary, RunView } from '@uw/harness';
import { formatInstant } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Card } from '@uw/ui/components/card.tsx';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { zulipConfigOf } from '../../notify/zulip/config.ts';
import { itemTopicUrl } from '../../notify/zulip/links.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { ItemHistory } from '../parts/item-history.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { runPath, runsPath } from '../parts/paths.ts';
import {
  agentName,
  markText,
  resumeMeaning,
  sleepingMeaning,
  spendText,
  statusOf,
  stepCostText,
  triedAgain,
} from '../parts/run-words.ts';
import { kindParam } from '../parts/timeline.tsx';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { notFound } from './not-found.tsx';

const wholeNumber = /^(?:0|[1-9]\d{0,15})$/;

function afterOf(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  return wholeNumber.test(raw) ? Number(raw) : null;
}

const stepNames: Readonly<Record<RunStepRecord['step'], string>> = {
  read: 'Read the item and its context',
  scout: 'Scout: check the premise still holds',
  work: 'Work',
  submit: 'Submit to the gate',
};

function Step(props: {
  readonly steps: readonly RunStepRecord[];
  readonly index: number;
  readonly run: RunSummary;
}) {
  const step = props.steps[props.index];
  if (step === undefined) return null;
  const again = triedAgain(props.steps, props.index);
  const tokens = formatCount(step.tokensIn + step.tokensOut);
  return (
    <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-3 last:border-b-0">
      <span class="font-heavy text-text">{stepNames[step.step]}</span>
      {again ? <Badge tone="info">Tried again</Badge> : null}
      <span class="text-sm text-text-3">{formatInstant(new Date(step.at))}</span>
      <span class="ml-auto font-mono text-xs text-text-3">
        {`${step.model ?? 'model not reported'} · ${tokens} tokens · ${stepCostText(step, props.run.spend.basis)}`}
      </span>
    </li>
  );
}

function Sleeping(props: { readonly run: RunSummary }) {
  const { run } = props;
  if (run.outcome !== 'hibernated' || run.hibernatedFor === null) return null;
  return (
    <p class="m-0 rounded-md border border-line bg-raised px-3 py-2 text-sm text-text">
      <span class="font-heavy">{statusOf(run).text}. </span>
      {sleepingMeaning[run.hibernatedFor]}
    </p>
  );
}

function Controls(props: { readonly harnessId: string; readonly run: RunSummary }) {
  const { harnessId, run } = props;
  if (!run.canStop && !run.canTakeOver) return null;
  return (
    <span class="flex flex-wrap items-center gap-2">
      {run.canStop ? (
        <CommandForm harnessId={harnessId} command="stop_run" itemId={run.itemId}>
          <input type="hidden" name="itemId" value={run.itemId} />
          <button type="submit" class={commandButton}>
            Stop run
          </button>
        </CommandForm>
      ) : null}
      {run.canTakeOver ? (
        <CommandForm harnessId={harnessId} command="take_over" itemId={run.itemId}>
          <input type="hidden" name="itemId" value={run.itemId} />
          <HumanActionButton
            itemId={run.itemId}
            label="Take over"
            name="action"
            value="take_over"
          />
        </CommandForm>
      ) : null}
    </span>
  );
}

function WhatItDid(props: { readonly view: RunView }) {
  const { view } = props;
  const { run, steps, marks } = view;
  const status = statusOf(run);
  return (
    <Card
      title="What the run did"
      sub={`${agentName(run)} · ${spendText(run.spend)}`}
      actions={<Badge tone={status.tone}>{status.text}</Badge>}
    >
      <Controls harnessId={view.harness.id} run={run} />
      {steps.length === 0 ? (
        <p class="m-0 text-sm text-text-3">No step has finished yet.</p>
      ) : (
        <ol class="m-0 list-none p-0">
          {steps.map((_step, index) => (
            <Step steps={steps} index={index} run={run} />
          ))}
        </ol>
      )}
      <Sleeping run={run} />
      {marks.length === 0 ? null : (
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm text-text-3">
          {marks.map((mark) => (
            <li>{`${formatInstant(new Date(mark.at))}: ${markText(mark)}`}</li>
          ))}
        </ul>
      )}
      <p class="m-0 text-sm text-text-3">{resumeMeaning}</p>
    </Card>
  );
}

async function specOf(screen: ScreenKernel, view: RunView, runId: string) {
  const { harness, play } = view;
  const harnessId = harness.id;
  const cursor = await screen.kernel.views.cursor(screen.caller, { harnessId }, { at: screen.at });
  return {
    title: `${play.item.title} ${pageNames.run}`,
    current: runPath(harnessId, runId),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(harness.title, runsPath(harnessId), pageNames.run),
    tabs: workflowTabs(harnessId, 'runs', await waitingCount(screen, harnessId)),
    live: {
      screen: 'item' as const,
      harnesses: [{ harnessId, cursor }],
      itemId: play.item.itemId,
    },
  };
}

export async function runScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  const runId = idParam(c.req.param('runId'));
  const after = afterOf(c.req.query('after'));
  if (harnessId === null || runId === null || after === null) return notFound(c);
  const read = { at: screen.at };
  const outcome = await screen.kernel.views.run(screen.caller, { harnessId, runId, after }, read);
  if (outcome.status !== 'accepted') return notFound(c);
  const view = outcome.value;
  const { harness, play } = view;
  const spec = await specOf(screen, view, runId);
  const zulipUrl = itemTopicUrl(zulipConfigOf(c.env), harness.jdArea, play.item.zulipTopic);
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow="Run"
        title={play.item.title}
        lede={`At ${play.stage.title} on ${harness.title}. Started ${formatInstant(view.run.startedAt)}.`}
      />
      <div class="flex flex-col gap-5">
        <WhatItDid view={view} />
        <section aria-labelledby="item-history" class="flex flex-col">
          <h2 id="item-history" class="m-0 mb-3 text-md font-heavy text-text">
            Everything that happened to this item
          </h2>
          <ItemHistory
            play={play}
            zulipUrl={zulipUrl}
            base={runPath(harnessId, runId)}
            kind={kindParam(c.req.query('kind'))}
          />
        </section>
      </div>
    </>,
  );
}
