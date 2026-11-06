import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { Sidebar, type NavItem } from './sidebar.tsx';
import { themeScript } from './inline-scripts.ts';
import { TopBar, type Crumb } from './top-bar.tsx';

export function Shell(props: {
  readonly title: string;
  readonly nav: readonly NavItem[];
  readonly current: string;
  readonly crumbs: readonly Crumb[];
  readonly stylesheet: string;
  readonly script?: string;
  readonly children?: Child;
}) {
  return (
    <html lang="en">
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
      <body class="min-h-dvh bg-canvas font-sans text-base text-text">
        <a
          href="#main"
          class="sr-only bg-surface text-accent-text outline-offset-2 outline-accent-text focus-visible:not-sr-only focus-visible:absolute focus-visible:outline-2"
        >
          <span class="block p-2">Skip to content</span>
        </a>
        <div class="grid min-h-dvh md:grid-cols-frame">
          <Sidebar items={props.nav} current={props.current} />
          <div class="flex min-w-0 flex-col">
            <TopBar crumbs={props.crumbs} />
            <main id="main" tabindex={-1} class="min-w-0 flex-1 p-4 md:p-5">
              {props.children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
