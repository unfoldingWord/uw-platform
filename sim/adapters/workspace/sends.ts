import {
  attendingPerson,
  copiedToPerson,
  type CalendarFailure,
  type CalendarInvite,
  type Workspace,
} from '@uw/harness';
import { calendarOf, failure, troubled, type SimWorkspaceState } from './state.ts';

export function mailIn(state: SimWorkspaceState): Workspace['sendMail'] {
  return async (mail) => {
    await troubled(state);
    if (state.sent.has(mail.effectId)) return { outcome: 'sent' };
    const from = state.mailboxes.get(mail.harnessId);
    if (from === undefined) return { outcome: 'refused' };
    const failed: CalendarFailure | null = failure(state, mail.personId);
    if (failed !== null) return { outcome: failed };
    const person = state.emails.get(mail.personId) ?? null;
    state.sent.set(mail.effectId, {
      from,
      to: [...mail.to],
      cc: person === null ? [...mail.cc] : [...copiedToPerson(mail.to, mail.cc, person)],
      replyTo: person,
      subject: mail.subject,
      body: mail.body,
    });
    return { outcome: 'sent' };
  };
}

function attendeesOf(state: SimWorkspaceState, invite: CalendarInvite): string[] {
  const person = state.emails.get(invite.personId);
  return person === undefined
    ? [...invite.attendees]
    : [...attendingPerson(invite.attendees, person)];
}

export function inviteIn(state: SimWorkspaceState): Workspace['sendInvite'] {
  return async (invite) => {
    await troubled(state);
    const failed = failure(state, invite.personId);
    if (failed !== null) return { outcome: failed };
    const calendar = calendarOf(state, invite.personId);
    const eventId = invite.proposalId.replaceAll('-', '');
    if (!calendar.some((event) => event.eventId === eventId)) {
      calendar.push({
        eventId,
        title: invite.title,
        startsAt: invite.startsAt,
        endsAt: invite.endsAt,
        description: invite.description,
        attendees: attendeesOf(state, invite),
        organisedBySelf: true,
        visibility: 'default',
        notified: true,
        hold: null,
      });
    }
    return { outcome: 'invited', eventId };
  };
}
