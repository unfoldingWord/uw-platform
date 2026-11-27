import type { ProbeResult } from './report.ts';

const checks: readonly (readonly [string, string])[] = [
  [
    's3.6',
    'Zulip rate limits: watch for 429 and Retry-After in the logs while several people turn their assistants on',
  ],
  [
    's3.7',
    'Zulip webhook delivery: DM your own assistant bot and confirm uw-ingest logs a zulip-assistant delivery with trigger direct_message',
  ],
  [
    's3.8',
    'Zulip ownership: confirm assistant bots stay active while the service admin account is active',
  ],
  [
    's4.2',
    'Workflow instance id reuse: redeliver one queue message and confirm the AssistantTurn Workflow answers already exists (log assistant_turn_already_started)',
  ],
  [
    's4.3',
    'Workflow step semantics: deploy during a turn and confirm the person gets one reply and one assistant_turn_started',
  ],
  ['s4.4', 'Stale turns: confirm assistant_turns_swept logs abandoned 0 over a normal day'],
  [
    's5.7',
    'Rejected token: revoke a cached token in the admin console and confirm the next calendar read mints again',
  ],
  [
    's5.8',
    'Calendar latency from Workers: confirm read_my_calendar answers within the 5-second timeout in the logs',
  ],
  [
    's6.6',
    'Bot reactivation after a long deactivation: turn an assistant off, wait past the 30 days, turn it on, and confirm a DM gets a reply',
  ],
  ['s7.1', 'Undo a hold from My Assistant and confirm it leaves the calendar'],
  [
    's7.2',
    'Pairing code: show a code on My Assistant, DM it to the bot, and confirm the screen says paired with a code',
  ],
  [
    's7.3',
    'Nightly retention: confirm cron assistant retention logs history_redacted after cron assistant deletion',
  ],
  [
    's8.1b',
    'Forged header: send mail from outside the domain carrying a forged Authentication-Results line and confirm it is declined',
  ],
  [
    's8.8',
    'Subrequest budget: confirm a minute with 25 mailboxes stays under the plan limit (step assistant-mail in the minute log)',
  ],
  [
    's9.1',
    'Accept a proposed email on My Assistant and confirm it arrives once from the assistant with Reply-To the person',
  ],
  [
    's9.2',
    'Accept a proposed invitation and confirm the attendee receives Google’s invitation from the person',
  ],
  ['s9.3', 'Accept a page addition and confirm the page history shows the person as the saver'],
  [
    's9.4',
    'Open the proposal_waiting web push and the reply link and confirm both land on /assistant#proposal-<id>',
  ],
  [
    's9.5',
    'Paste a Zoom transcript into a DM and confirm the request records a meeting_transcript part',
  ],
  [
    's12.5',
    'Ask the assistant to read a script-only page (a single-page app); confirm the reply quotes its text and one page_rendered event is recorded (Browser Run markdown quick action)',
  ],
  [
    's12.6',
    'Ask for a conference itinerary with ticket prices; confirm the reply cites each address and price, and that no Duffel order exists in the Duffel dashboard',
  ],
];

export function manualChecks(): ProbeResult[] {
  return checks.map(([id, detail]) => ({ id, status: 'manual', detail }));
}
