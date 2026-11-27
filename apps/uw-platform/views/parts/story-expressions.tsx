import {
  expressionFormats,
  renderChannels,
  type ErrorReason,
  type StoryExpression,
} from '@uw/contracts';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Button } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { Disclosure } from '@uw/ui/components/disclosure.tsx';
import { SelectField, TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { safeHref } from '@uw/ui/components/href.ts';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { revealed } from '@uw/ui/components/list-row.tsx';
import { Section, SubHeading } from '@uw/ui/components/section.tsx';
import type { StoryState } from '../../stories/reads.ts';
import { byFormat } from '../../stories/story-records.ts';
import { pageLink } from './page-shown.ts';
import { storyCommandsPath } from './paths.ts';
import {
  channelWords,
  expressionStatusWords,
  flagWords,
  formatGroupWords,
  formatWords,
  wordFor,
} from './story-words.ts';

const ENDPOINT = storyCommandsPath();
const day = { maxLength: 10, hint: 'A calendar date, year first. Leave it blank until told.' };

function choicesOf(words: Readonly<Record<string, string>>, keys: readonly string[]) {
  return keys.map((value) => ({
    value,
    label: new Map(Object.entries(words)).get(value) ?? value,
  }));
}

function writeRefusal(state: StoryState): ErrorReason | null {
  return state.writer ? null : 'not_permitted';
}

type Shown = {
  readonly title: string;
  readonly format: string;
  readonly venue: string;
  readonly channel: string;
  readonly url: string;
  readonly publishedOn: string;
  readonly language: string;
  readonly excerpt: string;
};

const blank: Shown = {
  title: '',
  format: 'social_post',
  venue: '',
  channel: 'public',
  url: '',
  publishedOn: '',
  language: '',
  excerpt: '',
};

function shownOf(told: StoryExpression | undefined): Shown {
  if (told === undefined) return blank;
  const { title, format, venue, channel } = told;
  const optional = { url: told.url, publishedOn: told.publishedOn, language: told.language };
  const filled = Object.fromEntries(
    Object.entries({ ...optional, excerpt: told.excerpt }).map(([key, value]) => [
      key,
      value ?? '',
    ]),
  );
  return { ...blank, ...filled, title, format, venue, channel };
}

function WhatFields(props: { readonly scope: string; readonly shown: Shown }) {
  const { scope, shown } = props;
  return (
    <>
      <TextField
        name="title"
        label="Title"
        scope={scope}
        maxLength={300}
        value={shown.title}
        required
      />
      <SelectField
        name="format"
        label="Format"
        scope={scope}
        choices={choicesOf(formatWords, expressionFormats)}
        selected={shown.format}
      />
      <TextField
        name="venue"
        label="Where it was told"
        scope={scope}
        maxLength={120}
        value={shown.venue}
        required
      />
      <SelectField
        name="channel"
        label="Audience"
        scope={scope}
        choices={choicesOf(channelWords, renderChannels)}
        selected={shown.channel}
      />
    </>
  );
}

function WhereFields(props: { readonly scope: string; readonly shown: Shown }) {
  const { scope, shown } = props;
  return (
    <>
      <TextField
        name="url"
        label="Link, starting https://"
        scope={scope}
        maxLength={2000}
        value={shown.url}
        required
      />
      <TextField
        name="publishedOn"
        label="Told on"
        scope={scope}
        value={shown.publishedOn}
        {...day}
      />
      <TextField
        name="language"
        label="Language tag"
        scope={scope}
        maxLength={35}
        value={shown.language}
      />
      <TextAreaField
        name="excerpt"
        label="Short excerpt, never the whole text"
        scope={scope}
        maxLength={1000}
        value={shown.excerpt}
        rows={3}
      />
    </>
  );
}

function ExpressionFields(props: { readonly scope: string; readonly told?: StoryExpression }) {
  const shown = shownOf(props.told);
  return (
    <>
      <WhatFields scope={props.scope} shown={shown} />
      <WhereFields scope={props.scope} shown={shown} />
    </>
  );
}

function AddForm(props: { readonly state: StoryState }) {
  const id = props.state.story.id;
  const scope = `${id}-new-expression`;
  return (
    <Disclosure summary="Add expression" open={false}>
      <PlatformCommandForm endpoint={ENDPOINT} command="add_story_expression" scope={scope}>
        <input type="hidden" name="pageId" value={id} />
        <ExpressionFields scope={scope} />
        <Button
          type="submit"
          name="command"
          value="add_story_expression"
          label="Add expression"
          reasonId={`${scope}-reason`}
          disabledReason={writeRefusal(props.state)}
        />
      </PlatformCommandForm>
    </Disclosure>
  );
}

function EditForm(props: { readonly state: StoryState; readonly told: StoryExpression }) {
  const scope = `${props.told.id}-edit`;
  return (
    <Disclosure summary={`Edit ${props.told.title}`} open={false}>
      <PlatformCommandForm endpoint={ENDPOINT} command="update_story_expression" scope={scope}>
        <input type="hidden" name="expressionId" value={props.told.id} />
        <ExpressionFields scope={scope} told={props.told} />
        <Button
          type="submit"
          name="command"
          value="update_story_expression"
          label="Save"
          reasonId={`${scope}-reason`}
          disabledReason={writeRefusal(props.state)}
        />
      </PlatformCommandForm>
    </Disclosure>
  );
}

function Decisions(props: { readonly state: StoryState; readonly told: StoryExpression }) {
  const { told } = props;
  const refusal = writeRefusal(props.state);
  return (
    <div data-pdf-hidden="" class="flex flex-wrap items-center gap-2">
      {told.status === 'suggested' ? (
        <PlatformCommandForm
          endpoint={ENDPOINT}
          command="confirm_story_expression"
          scope={told.id}
          inline
        >
          <input type="hidden" name="expressionId" value={told.id} />
          <HumanActionButton
            itemId={told.id}
            label="Confirm"
            name="command"
            value="confirm_story_expression"
            disabledReason={refusal}
          />
        </PlatformCommandForm>
      ) : null}
      {told.status === 'retired' ? null : (
        <span class={revealed}>
          <PlatformCommandForm
            endpoint={ENDPOINT}
            command="retire_story_expression"
            scope={told.id}
            inline
          >
            <input type="hidden" name="expressionId" value={told.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              name="command"
              value="retire_story_expression"
              label={`Retire ${told.title}`}
              reasonId={`${told.id}-retire-reason`}
              disabledReason={refusal}
            >
              Retire
            </Button>
          </PlatformCommandForm>
        </span>
      )}
    </div>
  );
}

function Leaving(props: { readonly told: StoryExpression }) {
  const href = props.told.url === null ? undefined : safeHref(props.told.url);
  if (href === undefined) return <span class="font-semibold text-text">{props.told.title}</span>;
  return (
    <a href={href} rel="noopener noreferrer" class={pageLink} data-leaves-platform="">
      {props.told.title}{' '}
      <Icon name="arrow-up-right-from-square" size={2} label="Opens outside the platform" />
    </a>
  );
}

function Telling(props: { readonly state: StoryState; readonly told: StoryExpression }) {
  const { told } = props;
  const when = told.publishedOn ?? 'Not told yet';
  return (
    <li class="group/row flex flex-col gap-1" data-expression={told.id}>
      <p class="m-0 flex flex-wrap items-center gap-2 text-sm text-text">
        <Leaving told={told} />
        <Badge tone={told.status === 'confirmed' ? 'success' : 'neutral'}>
          {expressionStatusWords[told.status]}
        </Badge>
        {told.flags.map((flag) => (
          <Badge tone="held">{wordFor(flagWords, flag)}</Badge>
        ))}
      </p>
      <p class="m-0 text-sm text-text-3">{`${told.venue} · ${channelWords[told.channel]} · ${when}`}</p>
      {told.excerpt === null ? null : <p class="m-0 text-sm text-text-2">{told.excerpt}</p>}
      <Decisions state={props.state} told={told} />
      {props.state.writer ? <EditForm state={props.state} told={told} /> : null}
    </li>
  );
}

export function ExpressionsSection(props: { readonly state: StoryState }) {
  const { state } = props;
  const groups = byFormat(state.expressions);
  return (
    <Section
      title="Story expressions"
      headingId="story-expressions-heading"
      sub="Each telling of this story, in one format and venue. Links open outside the platform."
      attrs={{ 'data-story-expressions': state.story.id }}
    >
      {groups.length === 0 ? (
        <p class="m-0 text-sm text-text-3">No telling is linked yet.</p>
      ) : null}
      {groups.map((group) => (
        <div class="flex flex-col gap-2">
          <SubHeading title={formatGroupWords[group.format]} />
          <ul class="m-0 flex list-none flex-col gap-3 p-0">
            {group.expressions.map((told) => (
              <Telling state={state} told={told} />
            ))}
          </ul>
        </div>
      ))}
      <div data-pdf-hidden="">
        <AddForm state={state} />
      </div>
    </Section>
  );
}
