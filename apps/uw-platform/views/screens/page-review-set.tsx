import type { Context } from 'hono';
import type { SuggestedChangeInput } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { Button } from '@uw/ui/components/button.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import type { AppEnv } from '../../deps.ts';
import { applyChanges } from '../../pages/review-changes.ts';
import { acceptReviewSet, rejectReviewSet } from '../../pages/review-decisions.ts';
import { reviewSetFor, type FoundReviewSet } from '../../pages/review-sets.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { PageBand } from '../parts/page-read.tsx';
import {
  markOf,
  pageLink,
  pageScreenSpec,
  shownPage,
  type ShownPage,
} from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { pageMarkedExportPath, pagePath, pageReviewSetPath } from '../parts/paths.ts';
import { Who } from '../parts/person.tsx';
import { shownAuthor } from '../parts/person-names.ts';
import { WordChanges } from '../parts/word-changes.tsx';
import { notFound } from './not-found.tsx';

type Review = {
  readonly screen: ScreenKernel;
  readonly shown: ShownPage;
  readonly found: FoundReviewSet;
};

const refusalWords: Readonly<Record<string, string>> = {
  suggestion_changed:
    'These changes were revised after you opened them. Read them again before you decide.',
  stale_version:
    'The page has changed since these changes were suggested, so they can only be rejected.',
};

function refusalText(reason: string): string {
  return new Map(Object.entries(refusalWords)).get(reason) ?? `Not decided: ${reasonText(reason)}.`;
}

const statusWords: Readonly<Record<string, string>> = {
  accepted: 'This review set was accepted.',
  rejected: 'This review set was rejected.',
};

const kindWords: ReadonlyMap<SuggestedChangeInput['kind'], string> = new Map([
  ['insertion', 'Insert'],
  ['deletion', 'Delete'],
  ['replacement', 'Replace'],
  ['comment', 'Comment on'],
] as const);

function quoted(text: string): string {
  return text === '' ? 'a point in the text' : `"${text}"`;
}

function ChangeRow(props: { readonly change: SuggestedChangeInput }) {
  const { kind, anchor, text, note } = props.change;
  const what =
    kind === 'insertion'
      ? `Insert "${text}" after "${anchor.prefix.slice(-24)}"`
      : `${kindWords.get(kind) ?? ''} ${quoted(anchor.exact)}${kind === 'replacement' ? ` with "${text}"` : ''}`;
  return (
    <li data-suggested-change={kind} class="flex flex-col gap-1">
      <span class="text-sm text-text">{what}</span>
      {note === null ? null : <span class="text-sm text-text-2">{note}</span>}
    </li>
  );
}

function Decide(props: { readonly review: Review }) {
  const { shown, found } = props.review;
  const stale = found.set.baseVersion !== shown.page.version;
  return (
    <Section
      title="Decide"
      sub="Accepting saves every change in this set as one new version. Rejecting leaves the page as it is"
    >
      {stale ? (
        <Note>
          The page has changed since these changes were suggested, so they can only be rejected.
        </Note>
      ) : null}
      <form
        method="post"
        action={pageReviewSetPath(shown.page.id, found.set.id)}
        class="flex flex-wrap gap-3"
      >
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <input type="hidden" name="revision" value={String(found.set.revision)} />
        {stale ? null : (
          <Button type="submit" variant="human" name="intent" value="accept_review_set">
            Accept the review set
          </Button>
        )}
        <Button type="submit" variant="secondary" name="intent" value="reject_review_set">
          Reject the review set
        </Button>
      </form>
    </Section>
  );
}

function Changes(props: { readonly review: Review }) {
  const { found, shown } = props.review;
  const { set, changes } = found;
  const current = set.baseVersion === shown.page.version;
  return (
    <>
      {set.title === null ? null : (
        <Note>{`The title changes from "${shown.page.title}" to "${set.title}".`}</Note>
      )}
      {set.frontmatter === null ? null : <Note>The properties change too.</Note>}
      <Section title="Suggested changes" sub={`Against version ${String(set.baseVersion)}`}>
        <ul class="m-0 flex list-none flex-col gap-3 p-0">
          {changes.map((change) => (
            <ChangeRow change={change} />
          ))}
        </ul>
        <p class="m-0">
          <a href={pageMarkedExportPath(shown.page.id)} class={pageLink}>
            Export with suggested changes as markdown
          </a>
        </p>
      </Section>
      {current ? (
        <Section title="Text once accepted">
          <WordChanges
            before={shown.page.bodyMd}
            after={applyChanges(shown.page.bodyMd, changes)}
            same="These changes leave the text as it is."
          />
        </Section>
      ) : null}
    </>
  );
}

async function render(c: Context<AppEnv>, review: Review, refused: string | null) {
  const { screen, shown, found } = review;
  const reading = { reader: screen.caller.actor, at: screen.at };
  const suggester = await shownAuthor(c.get('database')?.db ?? null, found.set.createdBy);
  const spec = await pageScreenSpec(c, screen, shown, pageNames.pageReviewSet);
  const decided = statusWords[found.set.status] ?? null;
  return renderScreen(
    c,
    spec,
    <DocumentShape
      band={
        <PageBand
          status={
            <p class="m-0 flex flex-wrap items-center gap-2">
              <span>Suggested by</span>
              <Who reading={reading} who={suggester} />
              <span>{`on ${formatInstant(found.set.createdAt)}`}</span>
            </p>
          }
          actions={
            <a href={pagePath(shown.page.id)} class={pageLink}>
              Back to the page
            </a>
          }
        />
      }
      head={{
        eyebrow: markOf(shown.page),
        title: found.set.name,
        lede: `Suggested changes to ${shown.page.title}. Nothing reaches readers until a person accepts them.`,
      }}
    >
      {refused === null ? null : <Note>{refusalText(refused)}</Note>}
      {decided === null ? null : <Note>{decided}</Note>}
      <Changes review={review} />
      {decided === null && shown.canEdit ? <Decide review={review} /> : null}
    </DocumentShape>,
  );
}

async function reviewOf(c: Context<AppEnv>): Promise<Review | null> {
  const screen = screenKernel(c);
  const database = c.get('database');
  const pageId = idParam(c.req.param('pageId'));
  const reviewSetId = idParam(c.req.param('reviewSetId'));
  if (screen === null || database === null || pageId === null || reviewSetId === null) {
    return null;
  }
  const found = await reviewSetFor(database.db, screen.caller.actor, reviewSetId, screen.at);
  if (found?.page.id !== pageId) return null;
  const shown = await shownPage(c, screen, pageId);
  return shown === null ? null : { screen, shown, found };
}

export async function pageReviewSetScreen(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const review = await reviewOf(c);
  return review === null ? notFound(c) : render(c, review, null);
}

type Form = {
  readonly requestId: string;
  readonly intent: 'accept_review_set' | 'reject_review_set';
  readonly revision: number;
};

function formOf(posted: Readonly<Record<string, unknown>>): Form | null {
  const requestId = idParam(String(posted['requestId'] ?? ''));
  const intent = posted['intent'];
  const revision = Number(posted['revision']);
  if (requestId === null || !Number.isInteger(revision)) return null;
  if (intent !== 'accept_review_set' && intent !== 'reject_review_set') return null;
  return { requestId, intent, revision };
}

type Db = Parameters<typeof acceptReviewSet>[0];

function decide(review: Review, db: Db, form: Form) {
  const { actor, traceId } = review.screen.caller;
  const command = {
    requestId: form.requestId,
    reviewSetId: review.found.set.id,
    revision: form.revision,
  };
  const { at } = review.screen;
  return form.intent === 'accept_review_set'
    ? acceptReviewSet(db, actor, { command: form.intent, ...command }, traceId, at)
    : rejectReviewSet(db, actor, { command: form.intent, ...command }, traceId, at);
}

export async function decideReviewSet(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const review = await reviewOf(c);
  const database = c.get('database');
  if (review === null || database === null || !review.shown.canEdit) return notFound(c);
  const form = formOf(await c.req.parseBody());
  if (form === null) return render(c, review, 'malformed_command');
  const decided = await decide(review, database.db, form);
  if (!decided.ok) return render(c, review, decided.reason);
  const saved = form.intent === 'accept_review_set' ? `?saved=${String(decided.page.version)}` : '';
  return c.redirect(`${pagePath(review.shown.page.id)}${saved}`, 303);
}
