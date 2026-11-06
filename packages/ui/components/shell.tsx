import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { themeScript } from './inline-scripts.ts';
import { PhoneHeader, Sidebar, type NavSection, type Person } from './sidebar.tsx';
import { StatusBar, type Status } from './status-bar.tsx';
import { TopBar, type Crumb, type Tab } from './top-bar.tsx';

export type Frame = {
  readonly sections: readonly NavSection[];
  readonly person: Person | null;
  readonly waiting: number;
  readonly status: Status;
  readonly markPath: string;
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
    </head>
  );
}

export function Shell(props: {
  readonly title: string;
  readonly frame: Frame;
  readonly current: string;
  readonly crumbs: readonly Crumb[];
  readonly tabs?: readonly Tab[] | undefined;
  readonly actions?: Child | undefined;
  readonly stylesheet: string;
  readonly script?: string;
  readonly children?: Child;
}) {
  const { frame } = props;
  return (
    <html lang="en">
      <Head title={props.title} stylesheet={props.stylesheet} script={props.script} />
      <body class="min-h-dvh bg-canvas font-sans text-base text-text">
        <a
          href="#main"
          class="sr-only bg-surface text-accent-text outline-offset-2 outline-accent-text focus-visible:not-sr-only focus-visible:absolute focus-visible:outline-2"
        >
          <span class="block p-2">Skip to content</span>
        </a>
        <div class="grid min-h-dvh md:grid-cols-frame">
          <Sidebar
            sections={frame.sections}
            current={props.current}
            person={frame.person}
            markPath={frame.markPath}
          />
          <div class="flex min-w-0 flex-col">
            <PhoneHeader
              title={props.title}
              waiting={frame.waiting}
              sections={frame.sections}
              current={props.current}
              markPath={frame.markPath}
            />
            <TopBar crumbs={props.crumbs} tabs={props.tabs} actions={props.actions} />
            <main id="main" tabindex={-1} class="min-w-0 flex-1 p-4 md:p-5">
              {props.children}
            </main>
            <StatusBar status={frame.status} />
          </div>
        </div>
      </body>
    </html>
  );
}
