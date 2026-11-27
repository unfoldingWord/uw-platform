import { ASSISTANT_RETENTION_DAYS, type AssistantEffectKind } from '@uw/contracts';
import { formatZonedMinute } from '@uw/core/dates';
import type {
  AssistantOverview,
  AssistantSettingsRow,
  OverviewEffect,
  OverviewRequest,
} from '@uw/harness';
import { Badge, type BadgeTone } from '@uw/ui/components/badge.tsx';
import { Button, buttonClass } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { ASSISTANT_ENDPOINT } from './my-assistant-setup.tsx';

const kindWords: Readonly<Record<AssistantEffectKind, string>> = {
  reply_to_requester: 'Replied',
  reminder_set: 'Set a reminder',
  reminder_cancelled: 'Cancelled a reminder',
  calendar_hold_added: 'Held time',
  calendar_hold_changed: 'Changed a hold',
  calendar_hold_removed: 'Removed a hold',
  email_sent: 'Sent an email you accepted',
  invite_sent: 'Sent an invitation you accepted',
  page_appended: 'Added to a page you accepted',
};

const stateTones: Readonly<Record<OverviewEffect['state'], BadgeTone>> = {
  started: 'info',
  done: 'success',
  failed: 'held',
  undone: 'neutral',
};

const channelWords = { zulip_dm: 'Zulip', email: 'Email' } as const;

function zoneOf(overview: AssistantOverview): string {
  return overview.settings?.timezone ?? 'UTC';
}

function Undo(props: { readonly effectId: string; readonly label: string }) {
  return (
    <PlatformCommandForm
      endpoint={ASSISTANT_ENDPOINT}
      command="undo_assistant_effect"
      scope={props.effectId}
      done="Undone."
      inline
    >
      <input type="hidden" name="effectId" value={props.effectId} />
      <Button type="submit" size="sm" label={props.label}>
        Undo
      </Button>
    </PlatformCommandForm>
  );
}

function Effect(props: { readonly effect: OverviewEffect }) {
  const { effect } = props;
  const state = effect.why === null ? reasonText(effect.state) : reasonText(effect.why);
  return (
    <li class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-text">{kindWords[effect.kind]}</span>
      <Badge tone={stateTones[effect.state]}>{state}</Badge>
      {effect.undoable ? (
        <Undo effectId={effect.effectId} label={`Undo: ${kindWords[effect.kind]}`} />
      ) : null}
    </li>
  );
}

function requestRow(request: OverviewRequest, zone: string) {
  const asked = request.redacted
    ? 'Removed'
    : request.note === ''
      ? 'Forwarded text'
      : request.note;
  return {
    when: formatZonedMinute(request.recordedAt, zone),
    from: channelWords[request.channel],
    asked: <span id={`request-${request.requestId}`}>{asked}</span>,
    did: (
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        {request.refused === null ? null : (
          <li>
            <Badge tone="held">{`Not answered: ${reasonText(request.refused)}`}</Badge>
          </li>
        )}
        {request.effects.map((effect) => (
          <Effect effect={effect} />
        ))}
      </ul>
    ),
  };
}

const requestColumns = [
  { key: 'when', label: 'When' },
  { key: 'from', label: 'From' },
  { key: 'asked', label: 'You asked', wide: 'medium' as const },
  { key: 'did', label: 'It did', wide: 'medium' as const },
];

export function Requests(props: { readonly overview: AssistantOverview }) {
  const { overview } = props;
  return (
    <Section title="Recent requests" sub="Newest first">
      {overview.requests.length === 0 ? (
        <EmptyState
          title="No requests yet."
          text="Send your assistant a direct message on Zulip and it answers here too."
        />
      ) : (
        <Table
          caption="Recent requests"
          columns={requestColumns}
          rows={overview.requests.map((request) => requestRow(request, zoneOf(overview)))}
          bare
        />
      )}
    </Section>
  );
}

export function Reminders(props: { readonly overview: AssistantOverview }) {
  const { overview } = props;
  const zone = zoneOf(overview);
  return (
    <Section title="Reminders and holds" sub={zone}>
      {overview.reminders.length === 0 && overview.holds.length === 0 ? (
        <p class="m-0 text-sm text-text-3">No reminders are set and no time is held.</p>
      ) : (
        <RowList label="Reminders and holds">
          {overview.reminders.map((reminder) => (
            <ListRow
              title={reminder.text}
              meta={`Reminder at ${formatZonedMinute(reminder.dueAt, zone)}`}
              actions={<Undo effectId={reminder.effectId} label={`Cancel ${reminder.text}`} />}
            />
          ))}
          {overview.holds.map((hold) => (
            <ListRow
              title={hold.title}
              meta={`Held ${formatZonedMinute(hold.startsAt, zone)} to ${formatZonedMinute(hold.endsAt, zone)}`}
              actions={<Undo effectId={hold.effectId} label={`Remove the hold ${hold.title}`} />}
            />
          ))}
        </RowList>
      )}
    </Section>
  );
}

function SettingsForm(props: { readonly settings: AssistantSettingsRow | null }) {
  const { settings } = props;
  return (
    <PlatformCommandForm
      endpoint={ASSISTANT_ENDPOINT}
      command="customise_assistant"
      scope="assistant"
      done="Saved."
    >
      <input type="hidden" name="expectedVersion" value={String(settings?.version ?? 0)} />
      <TextField
        name="displayName"
        label="Display name"
        scope="assistant"
        value={settings?.displayName ?? ''}
        required
        maxLength={60}
      />
      <TextField
        name="timezone"
        label="Timezone"
        scope="assistant"
        value={settings?.timezone ?? 'UTC'}
        required
        maxLength={64}
        hint="A name such as Africa/Nairobi or America/Chicago."
      />
      <div class="flex w-full min-w-0 flex-col">
        <TextAreaField
          name="instructionsMd"
          label="Instructions"
          scope="assistant"
          maxLength={8000}
          value={settings?.instructionsMd ?? ''}
          rows={6}
          hint="How you want it to answer. It still keeps to its role."
        />
      </div>
      <div class="flex w-full justify-end">
        <Button type="submit" variant="human">
          Save
        </Button>
      </div>
    </PlatformCommandForm>
  );
}

function SettingsRead(props: { readonly settings: AssistantSettingsRow | null }) {
  const { settings } = props;
  if (settings === null) return <p class="m-0 text-sm text-text-3">Not customised yet.</p>;
  const { displayName: called, timezone, instructionsMd } = settings;
  const instructions = instructionsMd === '' ? 'None' : instructionsMd;
  return (
    <div class="flex flex-col gap-1 text-sm text-text">
      <p class="m-0">{`Display name: ${called}`}</p>
      <p class="m-0">{`Timezone: ${timezone}`}</p>
      <p class="m-0 whitespace-pre-wrap">{`Instructions: ${instructions}`}</p>
    </div>
  );
}

export function Settings(props: { readonly overview: AssistantOverview }) {
  const { settings } = props.overview;
  return (
    <Section title="Settings">
      <div class="flex flex-col gap-3">
        <details class="group/edit peer flex flex-col gap-3">
          <summary class={`${buttonClass('secondary', 'sm')} list-none self-start`}>
            <Icon name="pen" size={1} class="group-open/edit:hidden" />
            <span class="group-open/edit:hidden">Change settings</span>
            <span class="hidden group-open/edit:inline">Cancel</span>
          </summary>
          <div class="mt-3">
            <SettingsForm settings={settings} />
          </div>
        </details>
        <div class="peer-open:hidden">
          <SettingsRead settings={settings} />
        </div>
      </div>
    </Section>
  );
}

export function History() {
  return (
    <Section title="History">
      <p class="m-0 text-sm text-text-3">
        {`What you asked and what it replied is kept for ${String(ASSISTANT_RETENTION_DAYS)} days, then removed. The record that a request happened stays, with no text. Reminders still to come and time still held stay until they pass.`}
      </p>
      <PlatformCommandForm
        endpoint={ASSISTANT_ENDPOINT}
        command="delete_my_assistant_history"
        scope="assistant"
        done="Your history is deleted."
      >
        <Button type="submit">Delete your history now</Button>
      </PlatformCommandForm>
    </Section>
  );
}
