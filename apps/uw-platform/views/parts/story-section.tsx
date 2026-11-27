import type { Child } from 'hono/jsx';
import {
  consentForms,
  locationPrecisions,
  nameUses,
  raisesLevel,
  sensitivityLevels,
  type ErrorReason,
  type SensitivityLevel,
} from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Executor } from '@uw/db/client';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Button } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { Disclosure } from '@uw/ui/components/disclosure.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { storyStateFor, type ConsentShown, type StoryState } from '../../stories/reads.ts';
import type { ScreenKernel } from './frame.tsx';
import { storyCommandsPath } from './paths.ts';
import {
  channelWords,
  consentWords,
  formWords,
  levelWords,
  locationWords,
  nameUseWords,
  useWords,
  wordFor,
} from './story-words.ts';

type Page = { readonly id: string; readonly type: string };
type Choice = { readonly value: string; readonly label: string };

const STORY_TYPE = 'impact_story';
const yesNo: readonly Choice[] = [
  { value: 'false', label: 'No' },
  { value: 'true', label: 'Yes' },
];

function choicesOf(words: Readonly<Record<string, string>>, keys: readonly string[]): Choice[] {
  return keys.map((value) => ({ value, label: wordFor(words, value) }));
}

function levelsAbove(level: SensitivityLevel): SensitivityLevel[] {
  return sensitivityLevels.filter((each) => raisesLevel(level, each));
}

function levelsBelow(level: SensitivityLevel): SensitivityLevel[] {
  return sensitivityLevels.filter((each) => raisesLevel(each, level));
}

function consentRefusal(consent: ConsentShown): ErrorReason | null {
  if (consent.kind === 'recorded') return null;
  if (consent.kind === 'expired') return 'consent_expired';
  if (consent.kind === 'withdrawn') return 'consent_withdrawn';
  return 'consent_required';
}

function raiseRefusal(state: StoryState): ErrorReason | null {
  if (!state.admin) return 'not_permitted';
  if (levelsAbove(state.level).length === 0) return 'transition_not_allowed';
  return consentRefusal(state.consent);
}

function writeRefusal(state: StoryState): ErrorReason | null {
  return state.writer ? null : 'not_permitted';
}

function LevelForm(props: {
  readonly state: StoryState;
  readonly verb: 'raise' | 'lower';
  readonly refusal: ErrorReason | null;
}) {
  const { state, verb } = props;
  const id = state.story.id;
  const levels = verb === 'raise' ? levelsAbove(state.level) : levelsBelow(state.level);
  const scope = `${id}-${verb}`;
  const label = verb === 'raise' ? 'Raise' : 'Lower';
  const command = 'set_story_level';
  return (
    <PlatformCommandForm endpoint={storyCommandsPath()} command={command} scope={scope} inline>
      <input type="hidden" name="pageId" value={id} />
      {levels.length === 0 ? null : (
        <SelectField
          name="level"
          label={`${label} to`}
          scope={scope}
          choices={choicesOf(levelWords, levels)}
        />
      )}
      {verb === 'raise' ? (
        <HumanActionButton
          itemId={scope}
          label={label}
          name="command"
          value={command}
          disabledReason={props.refusal}
        />
      ) : (
        <Button
          type="submit"
          name="command"
          value={command}
          label={label}
          reasonId={`${scope}-reason`}
          disabledReason={levels.length === 0 ? 'transition_not_allowed' : props.refusal}
        />
      )}
    </PlatformCommandForm>
  );
}

function ConsentFields(props: { readonly scope: string }) {
  const { scope } = props;
  const day = { maxLength: 10, hint: 'A calendar date, year first.', scope };
  return (
    <>
      <TextField
        name="consentReference"
        label="Link to the stored release"
        scope={scope}
        maxLength={500}
        required
      />
      <TextField name="consentedBy" label="Who consented" scope={scope} maxLength={200} required />
      <SelectField
        name="consentForm"
        label="Form of consent"
        scope={scope}
        choices={choicesOf(formWords, consentForms)}
      />
      <TextField name="consentedOn" label="Consented on" required {...day} />
      <TextField name="consentExpires" label="Consent expires" {...day} />
      <TextField name="reviewOn" label="Review on" {...day} />
      <SelectField name="anonymised" label="Subject anonymised" scope={scope} choices={yesNo} />
      <SelectField
        name="nameUse"
        label="Names used"
        scope={scope}
        choices={choicesOf(nameUseWords, nameUses)}
      />
      <SelectField
        name="locationPrecision"
        label="Location shown"
        scope={scope}
        choices={choicesOf(locationWords, locationPrecisions)}
      />
      <SelectField name="photoRelease" label="Photo release" scope={scope} choices={yesNo} />
      <TextField
        name="photoReference"
        label="Link to the photo release"
        scope={scope}
        maxLength={500}
      />
    </>
  );
}

function ConsentForm(props: { readonly state: StoryState }) {
  const id = props.state.story.id;
  const command = 'record_story_consent';
  return (
    <Disclosure summary="Record consent" open={false}>
      <PlatformCommandForm endpoint={storyCommandsPath()} command={command} scope={id}>
        <input type="hidden" name="pageId" value={id} />
        <ConsentFields scope={id} />
        <Button
          type="submit"
          name="command"
          value={command}
          label="Record consent"
          reasonId={`${id}-consent-reason`}
          disabledReason={writeRefusal(props.state)}
        />
      </PlatformCommandForm>
    </Disclosure>
  );
}

function WithdrawForm(props: { readonly state: StoryState }) {
  const id = props.state.story.id;
  const command = 'withdraw_story_consent';
  return (
    <PlatformCommandForm endpoint={storyCommandsPath()} command={command} scope={id} inline>
      <input type="hidden" name="pageId" value={id} />
      <Button
        type="submit"
        name="command"
        value={command}
        label="Withdraw consent"
        reasonId={`${id}-withdraw-reason`}
        disabledReason={writeRefusal(props.state)}
      />
    </PlatformCommandForm>
  );
}

function consentLines(consent: ConsentShown): string[] {
  if (!('consentedBy' in consent)) return [`Consent: ${consentWords[consent.kind]}.`];
  return [
    `Consent: ${consentWords[consent.kind]}, ${wordFor(formWords, consent.consentForm)}, given by ${consent.consentedBy} on ${consent.consentedOn}.`,
    `Release: ${consent.consentReference}.`,
    `Expires: ${consent.consentExpires ?? 'never'}. Review on: ${consent.reviewOn ?? 'not set'}.`,
    `${wordFor(nameUseWords, consent.nameUse)}, ${wordFor(locationWords, consent.locationPrecision).toLowerCase()}, ${consent.anonymised ? 'anonymised' : 'not anonymised'}.`,
    `Photo release: ${consent.photoRelease ? (consent.photoReference ?? 'yes') : 'none'}.`,
  ];
}

function Uses(props: { readonly state: StoryState }) {
  const columns = [
    { key: 'when', label: 'When' },
    { key: 'kind', label: 'Use' },
    { key: 'channel', label: 'Channel' },
    { key: 'where', label: 'Where' },
    { key: 'version', label: 'Version' },
  ];
  const rows = props.state.uses.map((use) => ({
    when: formatDate(new Date(use.usedAt)),
    kind: useWords[use.kind],
    channel: channelWords[use.channel],
    where: use.reference,
    version: String(use.version),
  }));
  if (rows.length === 0) return <p class="m-0 text-sm text-text-3">It has not been used yet.</p>;
  return <Table caption="Every recorded use of this story" columns={columns} rows={rows} />;
}

function Media(props: { readonly state: StoryState }) {
  const { media } = props.state;
  if (media.length === 0) return null;
  const columns = [
    { key: 'name', label: 'File' },
    { key: 'level', label: 'Level' },
  ];
  const rows = media.map((each) => ({ name: each.name, level: levelWords[each.level] }));
  return <Table caption="The level of each file in this story" columns={columns} rows={rows} />;
}

function StorySection(props: { readonly state: StoryState }) {
  const { state } = props;
  return (
    <Section title="Story" headingId="story-state-heading" attrs={{ 'data-story': state.story.id }}>
      <p class="m-0 flex items-center gap-2 text-sm text-text">
        Level <Badge tone="info">{levelWords[state.level]}</Badge>
      </p>
      <ul class="m-0 flex flex-col gap-1 pl-5 text-sm text-text">
        {consentLines(state.consent).map((line) => (
          <li>{line}</li>
        ))}
      </ul>
      <div data-pdf-hidden="" class="flex flex-col gap-3">
        <LevelForm state={state} verb="raise" refusal={raiseRefusal(state)} />
        <LevelForm state={state} verb="lower" refusal={writeRefusal(state)} />
        <ConsentForm state={state} />
        <WithdrawForm state={state} />
      </div>
      <Media state={state} />
      <Uses state={state} />
    </Section>
  );
}

export async function storyParts(db: Executor, screen: ScreenKernel, page: Page): Promise<Child> {
  if (page.type !== STORY_TYPE) return null;
  const state = await storyStateFor(db, screen.caller.actor, page.id, screen.at);
  return state === null ? null : <StorySection state={state} />;
}
