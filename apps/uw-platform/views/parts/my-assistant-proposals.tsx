import {
  assistantProposalPayloadSchemas,
  type AssistantProposalKind,
  type AssistantProposalStatus,
} from '@uw/contracts';
import { formatZonedMinute } from '@uw/core/dates';
import type { AssistantOverview, OverviewProposal } from '@uw/harness';
import { Badge, type BadgeTone } from '@uw/ui/components/badge.tsx';
import { Button } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { ASSISTANT_ENDPOINT } from './my-assistant-setup.tsx';

type Line = { readonly label: string; readonly value: string };

const kindWords: Readonly<Record<AssistantProposalKind, string>> = {
  email: 'Email',
  invite: 'Invitation',
  page_append: 'Addition to a page',
};

const statusWords: Readonly<Record<AssistantProposalStatus, string>> = {
  pending: 'Waiting for you',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
};

const statusTones: Readonly<Record<AssistantProposalStatus, BadgeTone>> = {
  pending: 'person',
  accepted: 'success',
  declined: 'neutral',
  expired: 'neutral',
};

function withYou(addresses: readonly string[]): string {
  return addresses.length === 0 ? 'You' : `${addresses.join(', ')} and you`;
}

function emailLines(proposal: OverviewProposal): readonly Line[] {
  const mail = assistantProposalPayloadSchemas.email.safeParse(proposal.payload);
  if (!mail.success) return [];
  const cc = mail.data.cc ?? [];
  return [
    { label: 'To', value: mail.data.to.join(', ') },
    { label: 'Copy to', value: withYou(cc) },
    { label: 'Subject', value: mail.data.subject },
    { label: 'Message', value: mail.data.body },
  ];
}

function inviteLines(proposal: OverviewProposal, zone: string): readonly Line[] {
  const invite = assistantProposalPayloadSchemas.invite.safeParse(proposal.payload);
  if (!invite.success) return [];
  const starts = formatZonedMinute(new Date(invite.data.start), zone);
  const ends = formatZonedMinute(new Date(invite.data.end), zone);
  return [
    { label: 'Title', value: invite.data.title },
    { label: 'When', value: `${starts} to ${ends} (${zone})` },
    { label: 'Invites', value: withYou(invite.data.attendees) },
    ...(invite.data.description === undefined || invite.data.description === ''
      ? []
      : [{ label: 'Description', value: invite.data.description }]),
  ];
}

function appendLines(proposal: OverviewProposal): readonly Line[] {
  const append = assistantProposalPayloadSchemas.page_append.safeParse(proposal.payload);
  if (!append.success) return [];
  return [
    { label: 'Page', value: proposal.pageTitle ?? 'A page you can no longer read' },
    ...(append.data.heading === undefined
      ? []
      : [{ label: 'Heading', value: append.data.heading }]),
    { label: 'Text to add at the end', value: append.data.text },
  ];
}

function proposalLines(proposal: OverviewProposal, zone: string): readonly Line[] {
  if (proposal.kind === 'email') return emailLines(proposal);
  if (proposal.kind === 'invite') return inviteLines(proposal, zone);
  return appendLines(proposal);
}

function Decide(props: { readonly proposal: OverviewProposal }) {
  const { proposal } = props;
  const hidden = (
    <>
      <input type="hidden" name="proposalId" value={proposal.id} />
      <input type="hidden" name="digest" value={proposal.digest} />
    </>
  );
  return (
    <div class="flex flex-wrap gap-2">
      <PlatformCommandForm
        endpoint={ASSISTANT_ENDPOINT}
        command="decide_assistant_proposal"
        scope={`${proposal.id}-accept`}
        done="Accepted."
        inline
      >
        {hidden}
        <input type="hidden" name="decision" value="accept" />
        <Button type="submit" variant="human" label={`Accept: ${kindWords[proposal.kind]}`}>
          Accept
        </Button>
      </PlatformCommandForm>
      <PlatformCommandForm
        endpoint={ASSISTANT_ENDPOINT}
        command="decide_assistant_proposal"
        scope={`${proposal.id}-decline`}
        done="Declined."
        inline
      >
        {hidden}
        <input type="hidden" name="decision" value="decline" />
        <Button type="submit" label={`Decline: ${kindWords[proposal.kind]}`}>
          Decline
        </Button>
      </PlatformCommandForm>
    </div>
  );
}

function Waiting(props: { readonly proposal: OverviewProposal; readonly zone: string }) {
  const { proposal, zone } = props;
  return (
    <div id={`proposal-${proposal.id}`} class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="m-0 text-base font-semibold text-text">{kindWords[proposal.kind]}</h3>
        <Badge tone="person">{statusWords.pending}</Badge>
        <span class="text-sm text-text-3">
          {`Until ${formatZonedMinute(proposal.expiresAt, zone)}`}
        </span>
      </div>
      <div class="flex flex-col gap-2">
        {proposalLines(proposal, zone).map((line) => (
          <div class="flex flex-col gap-1">
            <p class="m-0 text-sm text-text-3">{line.label}</p>
            <p class="m-0 whitespace-pre-wrap break-words text-sm text-text">{line.value}</p>
          </div>
        ))}
      </div>
      <Decide proposal={proposal} />
    </div>
  );
}

function Decided(props: {
  readonly proposals: readonly OverviewProposal[];
  readonly zone: string;
}) {
  if (props.proposals.length === 0) return null;
  return (
    <RowList label="Decided proposals">
      {props.proposals.map((proposal) => (
        <ListRow
          attrs={{ id: `proposal-${proposal.id}` }}
          title={kindWords[proposal.kind]}
          meta={formatZonedMinute(proposal.decidedAt ?? proposal.expiresAt, props.zone)}
          trail={<Badge tone={statusTones[proposal.status]}>{statusWords[proposal.status]}</Badge>}
        />
      ))}
    </RowList>
  );
}

export function Proposals(props: { readonly overview: AssistantOverview }) {
  const { overview } = props;
  const zone = overview.settings?.timezone ?? 'UTC';
  const pending = overview.proposals.filter((proposal) => proposal.status === 'pending');
  const decided = overview.proposals.filter((proposal) => proposal.status !== 'pending');
  return (
    <Section
      title="Waiting for you"
      sub={`${String(pending.length)} to decide. Nothing is sent or written until you accept it. Every email copies you, and you are on every invitation.`}
    >
      {pending.length === 0 ? (
        <EmptyState
          title="Nothing waits for your decision."
          text="When your assistant drafts an email, an invitation or an addition to a page, it waits here until you accept or decline it."
        />
      ) : (
        pending.map((proposal) => <Waiting proposal={proposal} zone={zone} />)
      )}
      <Decided proposals={decided} zone={zone} />
    </Section>
  );
}
