import type { Context } from 'hono';
import { raw } from 'hono/html';
import {
  commentPageCommandSchema,
  resolveCommentCommandSchema,
  type PageComment,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import { formatInstant } from '@uw/core/dates';
import { Button } from '@uw/ui/components/button.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { TextAreaField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import { FormActions } from '@uw/ui/shapes/form.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { renderMarkdown } from '../../markdown/render.ts';
import { addComment, commentsOf, resolveComment } from '../../pages/comments.ts';
import type { PersonName } from '../../people/directory.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { pageLink, pageScreenSpec, shownPage, type ShownPage } from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { namesOf, shownIdentity, Who, type Reading, type Someone } from '../parts/person.tsx';
import { pageCommentsPath, pagePath } from '../parts/paths.ts';
import { PageBand } from '../parts/page-read.tsx';
import { notFound } from './not-found.tsx';

type Found = { readonly screen: ScreenKernel; readonly shown: ShownPage };
type Shown = PageComment & {
  readonly html: string;
  readonly mayResolve: boolean;
  readonly who: Someone;
};

function Comment(props: {
  readonly pageId: string;
  readonly comment: Shown;
  readonly reading: Reading;
}) {
  const { comment } = props;
  const when = formatInstant(new Date(comment.createdAt));
  return (
    <li
      data-comment={comment.id}
      class="flex flex-col gap-2 border-b border-line-soft py-4 first:pt-0 last:border-b-0"
    >
      <p class="m-0 flex flex-wrap items-center gap-2 text-sm text-text-3">
        <Who reading={props.reading} who={comment.who} />
        <span>{`${when}${comment.resolvedAt === null ? '' : ', resolved'}`}</span>
      </p>
      {comment.quote === null ? null : (
        <blockquote
          data-quote=""
          class="m-0 border-l-2 border-line-strong pl-3 text-sm text-text-2 italic"
        >
          {comment.quote}
        </blockquote>
      )}
      <div data-page-body="">{raw(comment.html)}</div>
      {comment.resolvedAt !== null || !comment.mayResolve ? null : (
        <form method="post" action={pageCommentsPath(props.pageId)}>
          <input type="hidden" name="intent" value="resolve" />
          <input type="hidden" name="requestId" value={crypto.randomUUID()} />
          <input type="hidden" name="commentId" value={comment.id} />
          <Button type="submit" size="sm">
            Resolve
          </Button>
        </form>
      )}
    </li>
  );
}

function AddForm(props: { readonly pageId: string; readonly typed: Typed }) {
  return (
    <Section title="Add a comment" sub="Say what is wrong, missing or unclear">
      <form method="post" action={pageCommentsPath(props.pageId)} class="flex flex-col gap-4">
        <input type="hidden" name="intent" value="add" />
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <TextAreaField
          name="quote"
          label="About these words"
          scope={props.pageId}
          value={props.typed.quote}
          rows={2}
          maxLength={500}
          hint="Leave empty to comment on the whole page."
        />
        <TextAreaField
          name="bodyMd"
          label="Comment"
          scope={props.pageId}
          value={props.typed.bodyMd}
          rows={4}
          maxLength={10_000}
          hint="Markdown works here."
        />
        <FormActions>
          <Button type="submit" variant="primary">
            Add comment
          </Button>
        </FormActions>
      </form>
    </Section>
  );
}

async function foundOf(c: Context<AppEnv>): Promise<Found | null> {
  const screen = screenKernel(c);
  const pageId = idParam(c.req.param('pageId'));
  if (screen === null || pageId === null) return null;
  const shown = await shownPage(c, screen, pageId);
  return shown === null ? null : { screen, shown };
}

async function shownComments(c: Context<AppEnv>, found: Found): Promise<readonly Shown[]> {
  const database = c.get('database');
  const { actor } = found.screen.caller;
  const { page } = found.shown;
  const comments =
    database === null
      ? []
      : ((await commentsOf(database.db, actor, page.id, found.screen.at)) ?? []);
  const editor = can(actor, 'write', { kind: 'area', area: page.jdArea }, found.screen.at);
  const names =
    database === null
      ? new Map<string, PersonName>()
      : await namesOf(
          database.db,
          comments.map((comment) => comment.author),
        );
  return Promise.all(
    comments.map(async (comment) => ({
      ...comment,
      html: (await renderMarkdown(comment.bodyMd)).html,
      mayResolve: editor || comment.author === actor.identity,
      who: shownIdentity(comment.author, names, (author) => author),
    })),
  );
}

type Typed = { readonly bodyMd: string; readonly quote: string };

function commentCount(count: number): string {
  if (count === 0) return 'No comments';
  return count === 1 ? '1 comment' : `${String(count)} comments`;
}
type State = { readonly refused: string | null; readonly typed: Typed };

async function render(c: Context<AppEnv>, found: Found, state: State): Promise<Response> {
  const { page } = found.shown;
  const comments = await shownComments(c, found);
  return renderScreen(
    c,
    await pageScreenSpec(c, found.screen, found.shown, pageNames.pageComments),
    <DocumentShape
      band={
        <PageBand
          status={commentCount(comments.length)}
          actions={
            <a href={pagePath(page.id)} class={pageLink}>
              Back to the page
            </a>
          }
        />
      }
      head={{
        eyebrow: pageNames.wiki,
        title: page.title,
        lede: 'Comments on this page, oldest first. Anyone who can read the page can comment.',
      }}
    >
      {state.refused === null ? null : <Note>{`Not added: ${reasonText(state.refused)}.`}</Note>}
      <Section title="Comments">
        {comments.length === 0 ? (
          <EmptyState
            title="No one has commented yet."
            text="Select words on the page and use Comment, or write below."
          />
        ) : (
          <ul class="m-0 flex list-none flex-col p-0">
            {comments.map((comment) => (
              <Comment
                pageId={page.id}
                comment={comment}
                reading={{ reader: found.screen.caller.actor, at: found.screen.at }}
              />
            ))}
          </ul>
        )}
      </Section>
      <AddForm pageId={page.id} typed={state.typed} />
    </DocumentShape>,
  );
}

export async function pageCommentsScreen(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const found = await foundOf(c);
  const quote = (c.req.query('quote') ?? '').trim().slice(0, 500);
  const typed = { bodyMd: '', quote };
  return found === null ? notFound(c) : render(c, found, { refused: null, typed });
}

const blank: Typed = { bodyMd: '', quote: '' };

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function commentFromForm(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const found = await foundOf(c);
  const database = c.get('database');
  if (found === null || database === null) return notFound(c);
  const posted = await c.req.parseBody();
  const { actor } = found.screen.caller;
  const { page } = found.shown;
  const back = c.redirect(pageCommentsPath(page.id), 303);
  if (posted['intent'] === 'resolve') {
    const settle = resolveCommentCommandSchema.safeParse({
      command: 'resolve_comment',
      requestId: posted['requestId'],
      commentId: posted['commentId'],
    });
    if (!settle.success) return render(c, found, { refused: 'malformed_command', typed: blank });
    const done = await resolveComment(database.db, actor, settle.data, found.screen.at);
    return done.ok ? back : render(c, found, { refused: done.reason, typed: blank });
  }
  const typed = { bodyMd: text(posted['bodyMd']), quote: text(posted['quote']).trim() };
  const said = commentPageCommandSchema.safeParse({
    command: 'comment_page',
    requestId: posted['requestId'],
    commentId: crypto.randomUUID(),
    pageId: page.id,
    bodyMd: typed.bodyMd,
    quote: typed.quote === '' ? null : typed.quote,
  });
  if (!said.success) return render(c, found, { refused: 'malformed_command', typed });
  const done = await addComment(database.db, actor, said.data, found.screen.at);
  return done.ok ? back : render(c, found, { refused: done.reason, typed });
}
