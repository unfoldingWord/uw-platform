import type { HoldMarker, Workspace } from '../ports.ts';

export type SentMail = {
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly replyTo: string | null;
  readonly subject: string;
  readonly body: string;
};

export type RecordedEvent = {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly attendees: readonly string[];
  readonly visibility: 'private' | 'default';
  readonly notified: boolean;
  readonly hold: HoldMarker | null;
};
export type SeededEvent = {
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly description?: string;
  readonly attendees?: readonly string[];
};
export type WorkspaceSubject = {
  readonly workspace: Workspace;
  readonly outsider: string;
  addPerson(email: string): Promise<string>;
  addEvent(personId: string, event: SeededEvent): Promise<string>;
  events(personId: string): Promise<readonly RecordedEvent[]>;
  addressesReached(): Promise<readonly string[]>;
  addMailbox(harnessId: string, personId: string, address: string): Promise<void>;
  mails(): Promise<readonly SentMail[]>;
};
