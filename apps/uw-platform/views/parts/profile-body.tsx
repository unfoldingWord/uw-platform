import { raw } from 'hono/html';
import { PROFILE_BODY_MOST, type Page } from '@uw/contracts';
import { Button, ButtonLink, buttonClass } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { TextAreaField } from '@uw/ui/components/field.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { renderPage } from '../../pages/render-page.ts';
import { readPage } from '../../pages/store.ts';
import { mayWriteProfileBody, profilePageId } from '../../people/profile-body.ts';
import type { ScreenKernel } from './frame.tsx';
import { pageCommentsPath } from './paths.ts';
import { withViews } from './view-embed.tsx';

type Db = Parameters<typeof profilePageId>[0];

const PROFILE_ENDPOINT = '/api/acl/commands';

export type ProfileBody = {
  readonly personId: string;
  readonly page: Page | null;
  readonly html: string | null;
  readonly writable: boolean;
  readonly self: boolean;
};

export async function profileBody(
  db: Db,
  screen: ScreenKernel,
  personId: string,
): Promise<ProfileBody> {
  const { actor } = screen.caller;
  const pageId = await profilePageId(db, personId);
  const page = pageId === null ? null : await readPage(db, actor, pageId, screen.at);
  const writable = mayWriteProfileBody(actor, personId, screen.at);
  const self = actor.personId === personId;
  if (page === null || page.bodyMd.trim() === '') {
    return { personId, page, html: null, writable, self };
  }
  const rendered = await withViews(db, screen, await renderPage(db, actor, page, screen.at));
  return { personId, page, html: rendered.html, writable, self };
}

function BodyForm(props: { readonly body: ProfileBody }) {
  const { body } = props;
  return (
    <PlatformCommandForm
      endpoint={PROFILE_ENDPOINT}
      command="save_profile_body"
      scope={body.personId}
      done="Saved."
    >
      <input type="hidden" name="personId" value={body.personId} />
      <input type="hidden" name="expectedVersion" value={String(body.page?.version ?? '')} />
      <div class="flex w-full min-w-0 flex-col">
        <TextAreaField
          name="bodyMd"
          label="About"
          scope={body.personId}
          hint="Markdown. Everyone who can read the directory sees this."
          maxLength={PROFILE_BODY_MOST}
          value={body.page?.bodyMd ?? ''}
          rows={8}
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

function Written(props: { readonly body: ProfileBody }) {
  if (props.body.html === null) return <p class="m-0 text-sm text-text-3">Nothing written yet.</p>;
  return <div data-page-body="">{raw(props.body.html)}</div>;
}

function Editable(props: { readonly body: ProfileBody }) {
  const { body } = props;
  const label = body.self ? 'Write about yourself' : 'Change what this says';
  return (
    <div class="flex flex-col gap-3">
      <details class="group/edit peer flex flex-col gap-3">
        <summary class={`${buttonClass('secondary', 'sm')} list-none self-start`}>
          <Icon name="pen" size={1} class="group-open/edit:hidden" />
          <span class="group-open/edit:hidden">{label}</span>
          <span class="hidden group-open/edit:inline">Cancel</span>
        </summary>
        <div class="mt-3">
          <BodyForm body={body} />
        </div>
      </details>
      <div class="peer-open:hidden">
        <Written body={body} />
      </div>
    </div>
  );
}

export function ProfileBodySection(props: { readonly body: ProfileBody }) {
  const { body } = props;
  const actions =
    body.page === null ? undefined : (
      <ButtonLink href={pageCommentsPath(body.page.id)} variant="ghost" size="sm" icon="comment">
        Comments
      </ButtonLink>
    );
  return (
    <Section title="About" actions={actions}>
      {body.writable ? <Editable body={body} /> : <Written body={body} />}
    </Section>
  );
}
