import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { speculationRules, themeScript } from './inline-scripts.ts';
import { AccountMenu, type LogOutLink, type Person } from './account-menu.tsx';
import { QuickSwitcher } from './quick-switcher.tsx';
import { PhoneHeader, Sidebar, type NavSection } from './sidebar.tsx';
import type { Status } from './status-bar.tsx';
import { Tabs } from './tabs.tsx';
import { TopBar, type Crumb, type Tab } from './top-bar.tsx';

export type Frame = {
  readonly sections: readonly NavSection[];
  readonly person: Person | null;
  readonly logOut: LogOutLink;
  readonly waiting: number;
  readonly status: Status;
  readonly wordmarkPath: string;
};

function Head(props: {
  readonly title: string;
  readonly stylesheet: string;
  readonly script?: string | undefined;
}) {
  return (
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <title>{props.title}</title>
      <script>{raw(themeScript)}</script>
      <link rel="stylesheet" href={props.stylesheet} />
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" href="/assets/icon.svg" type="image/svg+xml" />
      {props.script === undefined ? null : <script type="module" src={props.script}></script>}
      <script type="speculationrules">{raw(speculationRules)}</script>
    </head>
  );
}

function SkipLink() {
  return (
    <a
      href="#main"
      class="sr-only bg-surface text-accent-text outline-offset-2 outline-accent-text focus-visible:not-sr-only focus-visible:absolute focus-visible:outline-2"
    >
      <span class="block p-2">Skip to content</span>
    </a>
  );
}

function ViewTabs(props: { readonly tabs: readonly Tab[] }) {
  if (props.tabs.length === 0) return null;
  return (
    <div class="bg-surface px-5 pt-2 md:px-6">
      <div class="mx-auto w-full max-w-content">
        <Tabs tabs={props.tabs} />
      </div>
    </div>
  );
}

function Main(props: { readonly children?: Child }) {
  return (
    <main
      id="main"
      tabindex={-1}
      class="relative min-w-0 flex-1 bg-surface px-5 pt-6 pb-8 md:min-h-0 md:overflow-y-auto md:px-6 md:pt-7"
    >
      {props.children}
    </main>
  );
}

function Overlays(props: { readonly frame: Frame }) {
  return (
    <>
      <AccountMenu person={props.frame.person} logOut={props.frame.logOut} />
      <QuickSwitcher />
    </>
  );
}

function FocusMain(props: { readonly children?: Child }) {
  return (
    <main id="main" tabindex={-1} data-focus class="relative flex min-h-dvh min-w-0 flex-col">
      {props.children}
    </main>
  );
}

function Framed(props: {
  readonly title: string;
  readonly frame: Frame;
  readonly current: string;
  readonly code?: string | undefined;
  readonly crumbs: readonly Crumb[];
  readonly tabs?: readonly Tab[] | undefined;
  readonly actions?: Child | undefined;
  readonly bare?: boolean | undefined;
  readonly children?: Child;
}) {
  const { frame } = props;
  return (
    <div data-frame class="grid min-h-dvh md:h-dvh md:grid-cols-frame md:overflow-hidden">
      <Sidebar
        sections={frame.sections}
        current={props.current}
        person={frame.person}
        wordmarkPath={frame.wordmarkPath}
      />
      <div class="flex min-w-0 flex-col md:min-h-0">
        <PhoneHeader
          title={props.title}
          waiting={frame.waiting}
          sections={frame.sections}
          current={props.current}
          person={frame.person}
          wordmarkPath={frame.wordmarkPath}
        />
        {props.bare === true ? null : (
          <TopBar
            code={props.code}
            crumbs={props.crumbs}
            actions={props.actions}
            status={frame.status}
          />
        )}
        <ViewTabs tabs={props.tabs ?? []} />
        <Main>{props.children}</Main>
      </div>
    </div>
  );
}

export function Shell(props: {
  readonly title: string;
  readonly frame: Frame;
  readonly current: string;
  readonly code?: string | undefined;
  readonly crumbs: readonly Crumb[];
  readonly tabs?: readonly Tab[] | undefined;
  readonly actions?: Child | undefined;
  readonly stylesheet: string;
  readonly script?: string;
  readonly focus?: boolean | undefined;
  readonly bare?: boolean | undefined;
  readonly children?: Child;
}) {
  const { frame } = props;
  return (
    <html lang="en">
      <Head title={props.title} stylesheet={props.stylesheet} script={props.script} />
      <body class="min-h-dvh bg-surface font-sans text-base text-text">
        <SkipLink />
        <div data-progress aria-hidden="true"></div>
        {props.focus === true ? (
          <FocusMain>{props.children}</FocusMain>
        ) : (
          <Framed
            title={props.title}
            frame={frame}
            current={props.current}
            code={props.code}
            crumbs={props.crumbs}
            tabs={props.tabs}
            actions={props.actions}
            bare={props.bare}
          >
            {props.children}
          </Framed>
        )}
        <Overlays frame={frame} />
      </body>
    </html>
  );
}
