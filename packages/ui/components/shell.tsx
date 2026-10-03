import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { Sidebar, type NavItem } from './sidebar.tsx';
import { THEME_KEY } from './theme-switch.tsx';
import { TopBar, type Crumb } from './top-bar.tsx';

const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export function Shell(props: {
  readonly title: string;
  readonly nav: readonly NavItem[];
  readonly current: string;
  readonly crumbs: readonly Crumb[];
  readonly stylesheet: string;
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
      </head>
      <body class="min-h-dvh bg-bg font-sans text-base text-ink">
        <a
          href="#main"
          class="sr-only bg-surface p-2 text-link outline-offset-2 outline-focus focus-visible:not-sr-only focus-visible:absolute focus-visible:outline-2"
        >
          Skip to content
        </a>
        <div class="grid min-h-dvh md:grid-cols-[var(--uw-sidebar)_1fr]">
          <Sidebar items={props.nav} current={props.current} />
          <div class="flex min-w-0 flex-col">
            <TopBar crumbs={props.crumbs} />
            <main id="main" tabindex={-1} class="min-w-0 flex-1 p-4 md:p-6">
              {props.children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
