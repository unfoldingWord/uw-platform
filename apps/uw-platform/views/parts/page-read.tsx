import type { Child } from 'hono/jsx';
import type { PageEntry } from '@uw/contracts';
import { IconButton } from '@uw/ui/components/button.tsx';
import { fieldLabel } from '@uw/ui/components/field.tsx';
import { Menu, MenuItem, MenuLink, MenuRule } from '@uw/ui/components/menu.tsx';
import { RailList, railLink } from '@uw/ui/components/rail-list.tsx';
import type { Heading } from '../../markdown/render.ts';
import { pageLink } from './page-shown.ts';
import {
  pageCommentsPath,
  pageExportPath,
  pageManagePath,
  pageMarkedExportPath,
  pagePath,
  pageReviewNewPath,
  wikiNewPath,
} from './paths.ts';

const MIN_CONTENTS = 2;

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

const pagerLink = `flex min-w-0 flex-1 flex-col gap-1 rounded-md px-3 py-2 no-underline transition-colors motion-reveal hover:bg-raised ${focus}`;

export function commentWords(open: number): string {
  if (open === 0) return 'Comments';
  return open === 1 ? '1 open comment' : `${String(open)} open comments`;
}

export function PageBand(props: {
  readonly status: Child;
  readonly actions: Child;
  readonly attrs?: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <div
      data-band=""
      {...(props.attrs ?? {})}
      class="flex min-h-size-5 flex-wrap items-center gap-3 border-b border-line-soft pb-3"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm text-text-3">
        {props.status}
      </div>
      <div data-pdf-hidden="" class="ml-auto flex flex-wrap items-center gap-2">
        {props.actions}
      </div>
    </div>
  );
}

export type Fact = { readonly label: string; readonly value: Child };

export function Properties(props: { readonly facts: readonly Fact[] }) {
  return (
    <ul data-page-facts="" class="m-0 flex list-none flex-col gap-3 p-0">
      {props.facts.map((fact) => (
        <li class="flex min-w-0 flex-col gap-1">
          <span class={fieldLabel}>{fact.label}</span>
          <span class="text-sm text-text">{fact.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Contents(props: { readonly headings: readonly Heading[] }) {
  if (props.headings.length < MIN_CONTENTS) return null;
  return (
    <nav aria-label="On this page" data-pdf-hidden="">
      <RailList label="On this page">
        {props.headings.map((heading) => (
          <li>
            <a href={`#${heading.id}`} class={railLink}>
              {heading.text}
            </a>
          </li>
        ))}
      </RailList>
    </nav>
  );
}

export function CommentButton(props: { readonly pageId: string }) {
  return (
    <IconButton
      icon="comment"
      label="Comment on the selected words"
      attrs={{ 'data-comment-passage': '', 'data-href': pageCommentsPath(props.pageId) }}
    />
  );
}

const EXPORTS_ENDPOINT = '/api/exports';

function Subpages(props: { readonly pageId: string }) {
  return (
    <form method="post" action={EXPORTS_ENDPOINT}>
      <input type="hidden" name="kind" value="binder" />
      <input type="hidden" name="rootPageId" value={props.pageId} />
      <MenuItem type="submit" icon="layer-group">
        Export with subpages as PDF
      </MenuItem>
    </form>
  );
}

function ManageItems(props: { readonly pageId: string }) {
  return (
    <>
      <MenuRule />
      <MenuLink href={wikiNewPath({ parent: props.pageId })} icon="plus">
        New page under this one
      </MenuLink>
      <MenuLink href={pageManagePath(props.pageId)} icon="folder">
        Move, copy or retire
      </MenuLink>
      <MenuLink href={pageReviewNewPath(props.pageId)} icon="pen">
        Suggest changes
      </MenuLink>
    </>
  );
}

export function MoreMenu(props: {
  readonly pageId: string;
  readonly manage: boolean;
  readonly subpages: boolean;
}) {
  const { pageId } = props;
  return (
    <span data-page-more="" class="inline-flex">
      <Menu id={`page-more-${pageId}`} label="More">
        <MenuLink href={pageExportPath(pageId)} icon="file-code">
          Export as markdown
        </MenuLink>
        <MenuLink href={pageMarkedExportPath(pageId)} icon="file-code">
          Export with suggested changes
        </MenuLink>
        <MenuLink href={`${pagePath(pageId)}?format=pdf`} icon="file-export">
          Export as PDF
        </MenuLink>
        {props.subpages ? <Subpages pageId={pageId} /> : null}
        <MenuItem icon="file-lines" attrs={{ 'data-print': '' }}>
          Print
        </MenuItem>
        {props.manage ? <ManageItems pageId={pageId} /> : null}
      </Menu>
    </span>
  );
}

function PagerLink(props: {
  readonly entry: PageEntry | null;
  readonly rel: 'prev' | 'next';
  readonly label: string;
}) {
  if (props.entry === null) return <span class="hidden flex-1 md:block"></span>;
  const align = props.rel === 'next' ? 'md:text-right' : '';
  return (
    <a href={pagePath(props.entry.id)} rel={props.rel} class={`${pagerLink} ${align}`}>
      <span class="text-sm text-text-3">{props.label}</span>
      <span class="truncate text-base font-semibold text-accent-text">{props.entry.title}</span>
    </a>
  );
}

export function Pager(props: {
  readonly category: string;
  readonly previous: PageEntry | null;
  readonly next: PageEntry | null;
}) {
  if (props.previous === null && props.next === null) return null;
  return (
    <nav
      aria-label={`Pages in ${props.category}`}
      class="-mx-3 flex flex-col gap-2 border-t border-line-soft pt-4 md:flex-row"
    >
      <PagerLink entry={props.previous} rel="prev" label={`Previous in ${props.category}`} />
      <PagerLink entry={props.next} rel="next" label={`Next in ${props.category}`} />
    </nav>
  );
}

export function Connected(props: {
  readonly title: string;
  readonly mark: 'children' | 'backlinks';
  readonly pages: readonly PageEntry[];
}) {
  if (props.pages.length === 0) return null;
  return (
    <RailList label={props.title} attrs={{ [`data-${props.mark}`]: '' }}>
      {props.pages.map((entry) => (
        <li>
          <a href={pagePath(entry.id)} class={pageLink}>
            {entry.title}
          </a>
        </li>
      ))}
    </RailList>
  );
}
