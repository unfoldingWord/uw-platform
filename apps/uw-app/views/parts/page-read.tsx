import type { Child } from 'hono/jsx';
import type { PageEntry } from '@uw/contracts';
import { iconCommandButton } from '@uw/ui/components/command-form.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { QuickSwitcherButton } from '@uw/ui/components/quick-switcher.tsx';
import { Crumbs, type Crumb } from '@uw/ui/components/top-bar.tsx';
import type { Heading } from '../../markdown/render.ts';
import { pageLink } from './page-shown.ts';
import {
  pageCommentsPath,
  pageExportPath,
  pageManagePath,
  pagePath,
  wikiNewPath,
} from './paths.ts';

const MIN_CONTENTS = 2;

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

const chip = `inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 text-sm font-heavy text-accent-text hover:bg-hover ${focus}`;

const menuRow = `block w-full cursor-pointer rounded-sm px-3 py-2 text-left text-sm font-semibold text-text hover:bg-hover ${focus}`;

const pagerCard = `flex min-w-0 flex-1 flex-col gap-1 rounded-md border border-line bg-surface px-4 py-3 hover:bg-hover ${focus}`;

export function commentWords(open: number): string {
  if (open === 0) return 'Comments';
  return open === 1 ? '1 open comment' : `${String(open)} open comments`;
}

export function ReadBand(props: {
  readonly code?: string | undefined;
  readonly crumbs: readonly Crumb[];
  readonly actions: Child;
  readonly mark: string;
  readonly mono: boolean;
  readonly title: string;
  readonly facts: readonly Child[];
  readonly headings: readonly Heading[];
}) {
  return (
    <div
      data-band=""
      class="-mx-4 -mt-4 flex flex-col gap-5 border-b border-band-line bg-band px-4 pt-3 pb-6 md:-mx-5 md:-mt-5 md:px-7"
    >
      <div class="flex flex-wrap items-center gap-3">
        <Crumbs code={props.code} crumbs={props.crumbs} />
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <QuickSwitcherButton />
          {props.actions}
        </div>
      </div>
      <div class="mx-auto flex w-full max-w-flow flex-col gap-3">
        <PageHead eyebrow={props.mark} document={props.mono} title={props.title} flush />
        <p
          data-page-facts=""
          class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-3"
        >
          {props.facts.map((fact, index) => (
            <>
              {index === 0 ? null : <span aria-hidden="true">·</span>}
              {fact}
            </>
          ))}
        </p>
        <Contents headings={props.headings} />
      </div>
    </div>
  );
}

function Contents(props: { readonly headings: readonly Heading[] }) {
  if (props.headings.length < MIN_CONTENTS) return null;
  return (
    <nav aria-label="On this page">
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        {props.headings.map((heading) => (
          <li>
            <a href={`#${heading.id}`} class={chip}>
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CommentButton(props: { readonly pageId: string }) {
  return (
    <button
      type="button"
      data-comment-passage=""
      data-href={pageCommentsPath(props.pageId)}
      aria-label="Comment on the selected words"
      title="Comment on the selected words"
      class={iconCommandButton}
    >
      <Icon name="comment" size={1} />
    </button>
  );
}

export function MoreMenu(props: { readonly pageId: string; readonly manage: boolean }) {
  const { pageId } = props;
  return (
    <details data-page-more="" class="relative">
      <summary class={`${iconCommandButton} list-none`} title="More">
        <Icon name="ellipsis" size={1} />
        <span class="sr-only">More</span>
      </summary>
      <div class="absolute right-0 z-10 mt-2 flex w-aside flex-col gap-1 rounded-md border border-line bg-surface p-1 shadow-3">
        <a href={pageExportPath(pageId)} class={menuRow}>
          Export as markdown
        </a>
        <button type="button" data-print="" class={menuRow}>
          Print or save as PDF
        </button>
        {props.manage ? (
          <>
            <a href={wikiNewPath({ parent: pageId })} class={menuRow}>
              New page under this one
            </a>
            <a href={pageManagePath(pageId)} class={menuRow}>
              Move, copy or retire
            </a>
          </>
        ) : null}
      </div>
    </details>
  );
}

export function Pager(props: {
  readonly category: string;
  readonly previous: PageEntry | null;
  readonly next: PageEntry | null;
}) {
  if (props.previous === null && props.next === null) return null;
  return (
    <nav aria-label={`Pages in ${props.category}`} class="flex flex-col gap-3 md:flex-row">
      {props.previous === null ? (
        <span class="hidden flex-1 md:block"></span>
      ) : (
        <a href={pagePath(props.previous.id)} rel="prev" class={pagerCard}>
          <span class="text-xs font-heavy text-text-3">{`Previous in ${props.category}`}</span>
          <span class="truncate text-md font-heavy text-accent-text">{props.previous.title}</span>
        </a>
      )}
      {props.next === null ? (
        <span class="hidden flex-1 md:block"></span>
      ) : (
        <a href={pagePath(props.next.id)} rel="next" class={`${pagerCard} md:text-right`}>
          <span class="text-xs font-heavy text-text-3">{`Next in ${props.category}`}</span>
          <span class="truncate text-md font-heavy text-accent-text">{props.next.title}</span>
        </a>
      )}
    </nav>
  );
}

export function Connected(props: {
  readonly title: string;
  readonly mark: 'children' | 'backlinks';
  readonly pages: readonly PageEntry[];
}) {
  if (props.pages.length === 0) return null;
  const marked = { [`data-${props.mark}`]: '' };
  return (
    <section class="flex min-w-0 flex-1 flex-col gap-2">
      <h2 class="m-0 text-xs font-heavy tracking-wide text-text-3 uppercase">{props.title}</h2>
      <ul class="m-0 flex list-none flex-col gap-1 p-0" {...marked}>
        {props.pages.map((entry) => (
          <li>
            <a href={pagePath(entry.id)} class={pageLink}>
              {entry.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
