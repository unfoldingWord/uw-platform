import { raw } from 'hono/html';
import { PROFILE_BODY_MOST, type Page } from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { PlatformCommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { TextAreaField } from '@uw/ui/components/field.tsx';
import { renderPage } from '../../pages/render-page.ts';
import { readPage } from '../../pages/store.ts';
import { mayWriteProfileBody, profilePageId } from '../../people/profile-body.ts';
import type { ScreenKernel } from './frame.tsx';
import { pageLink } from './page-shown.ts';
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
  const label = body.self ? 'Write about yourself' : 'Change what this says';
  return (
    <details>
      <summary class="cursor-pointer text-xs text-text-3 outline-offset-2 outline-accent-text focus-visible:outline-2">
        {label}
      </summary>
      <div class="mt-2">
        <PlatformCommandForm
          endpoint={PROFILE_ENDPOINT}
          command="save_profile_body"
          scope={body.personId}
          done="Saved."
        >
          <input type="hidden" name="personId" value={body.personId} />
          <input type="hidden" name="expectedVersion" value={String(body.page?.version ?? '')} />
          <TextAreaField
            name="bodyMd"
            label="About"
            scope={body.personId}
            hint="Markdown. Everyone who can read the directory sees this."
            maxLength={PROFILE_BODY_MOST}
            value={body.page?.bodyMd ?? ''}
            rows={8}
          />
          <button type="submit" class={commandButton}>
            Save
          </button>
        </PlatformCommandForm>
      </div>
    </details>
  );
}

export function ProfileBodyCard(props: { readonly body: ProfileBody }) {
  const { body } = props;
  const actions =
    body.page === null ? undefined : (
      <a href={pageCommentsPath(body.page.id)} class={pageLink}>
        Comments
      </a>
    );
  return (
    <Card title="About" actions={actions}>
      <div class="flex flex-col gap-3">
        {body.html === null ? (
          <p class="m-0 text-sm text-text-3">Nothing written yet.</p>
        ) : (
          <div data-page-body="">{raw(body.html)}</div>
        )}
        {body.writable ? <BodyForm body={body} /> : null}
      </div>
    </Card>
  );
}
