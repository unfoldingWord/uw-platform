import type { CalendarFailure, Workspace } from '@uw/harness';
import { calendarOf, failure, troubled, type SimWorkspaceState } from './state.ts';

export function mailIn(state: SimWorkspaceState): Workspace['sendMail'] {
  return async (mail) => {
    await troubled(state);
    if (state.sent.has(mail.effectId)) return { outcome: 'sent' };
    const from = state.mailboxes.get(mail.harnessId);
    if (from === undefined) return { outcome: 'refused' };
    const failed: CalendarFailure | null = failure(state, mail.personId);
    if (failed !== null) return { outcome: failed };
    state.sent.set(mail.effectId, {
      from,
      to: [...mail.to],
      cc: [...mail.cc],
      replyTo: state.emails.get(mail.personId) ?? null,
      subject: mail.subject,
      body: mail.body,
    });
    return { outcome: 'sent' };
  };
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
        attendees: [...invite.attendees],
        organisedBySelf: true,
        visibility: 'default',
        notified: true,
        hold: null,
      });
    }
    return { outcome: 'invited', eventId };
  };
}
