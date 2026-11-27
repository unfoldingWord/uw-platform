import { assistantProposalPayloadSchemas, type AssistantEffectFailure } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Caller } from '../caller.ts';
import type { AssistantEffectRow, AssistantProposalRow, Ports } from '../ports.ts';
import { askCalendar } from './calendar-port.ts';

export type ExecutePorts = Pick<Ports, 'workspace' | 'pageAppends'>;
export type Execution = {
  readonly proposal: AssistantProposalRow;
  readonly effect: AssistantEffectRow;
  readonly assistantName: string;
  readonly at: Date;
};

type Failure = AssistantEffectFailure | null;

function workspaceFailure(outcome: string): Failure {
  if (outcome === 'refused') return 'workspace_refused';
  if (outcome === 'outcome_unknown') return 'outcome_unknown';
  return 'workspace_unavailable';
}

async function sendMail(ports: ExecutePorts, run: Execution): Promise<Failure> {
  const { proposal, effect } = run;
  const mail = assistantProposalPayloadSchemas.email.parse(proposal.payload);
  const sent = await askCalendar(() =>
    ports.workspace.sendMail({
      harnessId: proposal.harnessId,
      proposalId: proposal.id,
      personId: proposal.personId,
      effectId: effect.id,
      to: mail.to,
      cc: mail.cc ?? [],
      subject: mail.subject,
      body: mail.body,
    }),
  );
  if (sent === 'not_wired') return 'not_wired';
  return sent.outcome === 'sent' ? null : workspaceFailure(sent.outcome);
}

async function sendInvite(ports: ExecutePorts, run: Execution): Promise<Failure> {
  const { proposal } = run;
  const invite = assistantProposalPayloadSchemas.invite.parse(proposal.payload);
  const sent = await askCalendar(() =>
    ports.workspace.sendInvite({
      harnessId: proposal.harnessId,
      proposalId: proposal.id,
      personId: proposal.personId,
      title: invite.title,
      startsAt: new Date(invite.start),
      endsAt: new Date(invite.end),
      attendees: invite.attendees,
      description: invite.description ?? '',
    }),
  );
  if (sent === 'not_wired') return 'not_wired';
  return sent.outcome === 'invited' ? null : workspaceFailure(sent.outcome);
}

function appendedBlock(run: Execution): string {
  const append = assistantProposalPayloadSchemas.page_append.parse(run.proposal.payload);
  const heading = append.heading === undefined ? [] : [`## ${append.heading}`, ''];
  const provenance = `_Added by ${run.assistantName}, an assistant, from a proposal its person accepted on ${formatDate(run.at)}._`;
  return [...heading, append.text, '', provenance].join('\n');
}

async function appendPage(ports: ExecutePorts, caller: Caller, run: Execution): Promise<Failure> {
  const { pageId } = assistantProposalPayloadSchemas.page_append.parse(run.proposal.payload);
  const appended = await askCalendar(() =>
    ports.pageAppends.append(caller.actor, {
      pageId,
      block: appendedBlock(run),
      requestId: run.effect.id,
      traceId: caller.traceId,
    }),
  );
  if (appended === 'not_wired') return 'not_wired';
  return appended.outcome === 'appended' ? null : 'page_refused';
}

export function executeProposal(
  ports: ExecutePorts,
  caller: Caller,
  run: Execution,
): Promise<Failure> {
  if (run.proposal.kind === 'email') return sendMail(ports, run);
  if (run.proposal.kind === 'invite') return sendInvite(ports, run);
  return appendPage(ports, caller, run);
}
