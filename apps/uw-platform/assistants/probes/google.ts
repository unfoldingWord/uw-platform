import type { CalendarHold } from '@uw/harness';
import { workspaceConfigOf } from '../google/config.ts';
import {
  deleteHold,
  freeBusy,
  insertHold,
  listEvents,
  postHold,
  readEvent,
} from '../google/calendar.ts';
import { accessToken, GOOGLE_SCOPES, type SubjectKind, type TokenDeps } from '../google/token.ts';
import { checked, skipped, type ProbeResult } from './report.ts';
import { addressOf, bindingsOf, notConfigured, WRITES_ONLY, type ProbeDeps } from './setup.ts';

export type GoogleRig = {
  readonly tokens: TokenDeps;
  readonly domain: string;
  readonly person: string;
  readonly colleague: string | null;
  readonly mailbox: string | null;
  readonly admin: string | null;
};

const SETTINGS = ['GOOGLE_WORKSPACE_KEY', 'GOOGLE_WORKSPACE_DOMAIN', 'PROBE_PERSON_EMAIL'];
const READS = ['s5.1', 's5.2', 's5.3', 's5.4'];
const WRITES = ['s5.5', 's5.6'];
const DAY_MS = 24 * 60 * 60_000;
const HOLD_AHEAD_MS = 30 * DAY_MS;
const HOLD_MS = 15 * 60_000;

export function googleRig(deps: ProbeDeps): GoogleRig | string {
  const config = workspaceConfigOf(bindingsOf(deps.env));
  const person = addressOf(deps.env, 'PROBE_PERSON_EMAIL');
  if (config === null || person === null) return notConfigured(deps.env, SETTINGS);
  const mailbox = addressOf(deps.env, 'PROBE_ASSISTANT_MAILBOX');
  const kinds = new Map<string, SubjectKind>([[person, 'person']]);
  if (mailbox !== null) kinds.set(mailbox, 'assistant_mailbox');
  if (config.adminSubject !== null) kinds.set(config.adminSubject, 'admin');
  const tokens: TokenDeps = {
    account: config.account,
    fetcher: deps.fetcher,
    now: deps.now,
    lookup: async (email) => kinds.get(email) ?? null,
    cache: new Map(),
  };
  const colleague = addressOf(deps.env, 'PROBE_COLLEAGUE_EMAIL');
  return { tokens, domain: config.domain, person, colleague, mailbox, admin: config.adminSubject };
}

async function scopes(rig: GoogleRig): Promise<ProbeResult> {
  const asked: [string, string | null][] = [
    [GOOGLE_SCOPES.calendarFreeBusy, rig.person],
    [GOOGLE_SCOPES.gmail, rig.mailbox],
    [GOOGLE_SCOPES.directoryUser, rig.admin],
  ];
  const answers = await Promise.all(
    asked.flatMap(([scope, subject]) =>
      subject === null
        ? []
        : [accessToken(rig.tokens, subject, [scope]).then((minted) => [scope, minted] as const)],
    ),
  );
  const parts = answers.map(([scope, minted]) =>
    minted.ok ? `${scope} ok` : `${scope} ${minted.failure}`,
  );
  return checked(
    's5.2',
    answers.every(([, minted]) => minted.ok),
    parts.join('; '),
  );
}

async function reads(rig: GoogleRig, now: Date): Promise<ProbeResult[]> {
  const events = await accessToken(rig.tokens, rig.person, [GOOGLE_SCOPES.calendarEvents]);
  const token = checked(
    's5.1',
    events.ok,
    events.ok ? 'calendar.events token minted' : events.failure,
  );
  const window = { from: now, to: new Date(now.getTime() + DAY_MS) };
  const listed = await listEvents(rig.tokens, rig.person, window);
  const list = checked(
    's5.3',
    listed.outcome === 'listed',
    listed.outcome === 'listed'
      ? `${String(listed.entries.length)} events in the next day`
      : listed.outcome,
  );
  const busy =
    rig.colleague === null
      ? skipped('s5.4', notConfigured({}, ['PROBE_COLLEAGUE_EMAIL']))
      : await freeBusyProbe(rig, rig.colleague, window);
  return [token, await scopes(rig), list, busy];
}

async function freeBusyProbe(
  rig: GoogleRig,
  colleague: string,
  window: { readonly from: Date; readonly to: Date },
): Promise<ProbeResult> {
  const read = await freeBusy(rig.tokens, rig.person, [colleague], window);
  if (read.outcome !== 'answered') return checked('s5.4', false, read.outcome);
  const unknown = read.unknown.length === 0 ? 'none' : read.unknown.join(', ');
  return checked('s5.4', true, `busy blocks ${String(read.busy.length)}, unknown ${unknown}`);
}

async function holdProbes(rig: GoogleRig, now: Date): Promise<ProbeResult[]> {
  const startsAt = new Date(now.getTime() + HOLD_AHEAD_MS);
  const hold: CalendarHold = {
    holdId: crypto.randomUUID(),
    harnessId: crypto.randomUUID(),
    personId: crypto.randomUUID(),
    title: 'uw-platform staging probe hold',
    startsAt,
    endsAt: new Date(startsAt.getTime() + HOLD_MS),
  };
  const placed = await insertHold(rig.tokens, rig.person, hold);
  if (placed.outcome !== 'held')
    return [checked('s5.5', false, placed.outcome), skipped('s5.6', 'no hold')];
  const again = await postHold(rig.tokens, rig.person, hold);
  const conflict = !again.ok && again.failure === 'conflict';
  const reuse = again.ok ? 'answered 200' : again.failure;
  const insert = checked('s5.5', conflict, `held ${placed.eventId}; same id again ${reuse}`);
  const removal = { ...hold, eventId: placed.eventId };
  const first = await deleteHold(rig.tokens, rig.person, removal);
  const after = await readEvent(rig.tokens, rig.person, placed.eventId);
  const second = await deleteHold(rig.tokens, rig.person, removal);
  const read = after.ok ? 'read 200' : `read ${after.failure}`;
  const ok = first.outcome === 'released' && second.outcome === 'released';
  return [
    insert,
    checked('s5.6', ok, `delete ${first.outcome}, ${read}, delete again ${second.outcome}`),
  ];
}

export async function calendarProbes(deps: ProbeDeps): Promise<ProbeResult[]> {
  const rig = googleRig(deps);
  if (typeof rig === 'string') return [...READS, ...WRITES].map((id) => skipped(id, rig));
  const now = deps.now();
  const read = await reads(rig, now);
  if (!deps.write) return [...read, ...WRITES.map((id) => skipped(id, WRITES_ONLY))];
  return [...read, ...(await holdProbes(rig, now))];
}
