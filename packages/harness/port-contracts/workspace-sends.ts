import { expect, it } from 'vitest';
import type { CalendarInvite, OutgoingMail } from '../ports.ts';
import type { WorkspaceSubject } from './workspace-subject.ts';

type Open = () => Promise<WorkspaceSubject>;

const harnessId = 'c5000000-0000-4000-8000-0000000000a1';
const proposalId = 'c5000000-0000-4000-8000-0000000000d1';
const effectId = 'c5000000-0000-4000-8000-0000000000d2';
const mailbox = 'barnabas@example.org';
const at = (text: string) => new Date(`2026-12-01T${text}:00.000Z`);

function mailFor(personId: string): OutgoingMail {
  return {
    personId,
    harnessId,
    proposalId,
    effectId,
    to: ['ben@example.org'],
    cc: ['cy@example.org'],
    subject: 'Meeting notes',
    body: 'Here are the notes from today.',
  };
}

function inviteFor(personId: string): CalendarInvite {
  return {
    personId,
    harnessId,
    proposalId,
    title: 'Planning',
    startsAt: at('13:00'),
    endsAt: at('14:00'),
    attendees: ['ben@example.org'],
    description: 'Quarterly planning',
  };
}

function describeMail(open: Open): void {
  it("sends a proposed mail once from the assistant's own mailbox to its recipients, copying its person", async () => {
    const subject = await open();
    const ana = await subject.addPerson('ana@example.org');
    await subject.addMailbox(harnessId, ana, mailbox);
    await expect(subject.workspace.sendMail(mailFor(ana))).resolves.toEqual({ outcome: 'sent' });
    await expect(subject.workspace.sendMail(mailFor(ana))).resolves.toEqual({ outcome: 'sent' });
    expect(await subject.mails()).toEqual([
      {
        from: mailbox,
        to: ['ben@example.org'],
        cc: ['cy@example.org', 'ana@example.org'],
        replyTo: 'ana@example.org',
        subject: 'Meeting notes',
        body: 'Here are the notes from today.',
      },
    ]);
  });

  it('sends to anyone, inside the organization or not, and copies its person only once', async () => {
    const subject = await open();
    const ana = await subject.addPerson('ana@example.org');
    await subject.addMailbox(harnessId, ana, mailbox);
    const mail = { ...mailFor(ana), to: ['stranger@elsewhere.net', 'Ana@example.org'], cc: [] };
    await expect(subject.workspace.sendMail(mail)).resolves.toEqual({ outcome: 'sent' });
    const [sent] = await subject.mails();
    expect(sent?.to).toEqual(['stranger@elsewhere.net', 'Ana@example.org']);
    expect(sent?.cc).toEqual([]);
  });

  it('refuses to send from an assistant with no active mailbox, and sends nothing', async () => {
    const subject = await open();
    const ana = await subject.addPerson('ana@example.org');
    await expect(subject.workspace.sendMail(mailFor(ana))).resolves.toEqual({
      outcome: 'refused',
    });
    expect(await subject.mails()).toEqual([]);
  });
}

function describeInvite(open: Open): void {
  it("sends an invitation once from the person's own calendar to its attendees and its person", async () => {
    const subject = await open();
    const ana = await subject.addPerson('ana@example.org');
    const sent = await subject.workspace.sendInvite(inviteFor(ana));
    expect(sent.outcome).toBe('invited');
    const again = await subject.workspace.sendInvite(inviteFor(ana));
    expect(again).toEqual(sent);
    const events = await subject.events(ana);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: 'Planning',
      startsAt: at('13:00'),
      endsAt: at('14:00'),
      attendees: ['ben@example.org', 'ana@example.org'],
      notified: true,
      hold: null,
    });
  });

  it('invites anyone and lists its person as an attendee only once', async () => {
    const subject = await open();
    const ana = await subject.addPerson('ana@example.org');
    const invite = { ...inviteFor(ana), attendees: ['stranger@elsewhere.net', 'ana@example.org'] };
    expect((await subject.workspace.sendInvite(invite)).outcome).toBe('invited');
    const [event] = await subject.events(ana);
    expect(event?.attendees).toEqual(['stranger@elsewhere.net', 'ana@example.org']);
  });

  it('refuses an invitation from a person who is not in the organization', async () => {
    const subject = await open();
    const stranger = 'c5000000-0000-4000-8000-0000000000ff';
    await expect(subject.workspace.sendInvite(inviteFor(stranger))).resolves.toEqual({
      outcome: 'refused',
    });
  });
}

export function describeWorkspaceSends(open: Open): void {
  describeMail(open);
  describeInvite(open);
}
