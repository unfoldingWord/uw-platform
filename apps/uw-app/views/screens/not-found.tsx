import type { Context } from 'hono';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen } from '../parts/frame.tsx';
import { homePath } from '../parts/paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

export function notFound(c: Context<AppEnv>): Promise<Response> {
  return renderScreen(
    c,
    { title: 'Not found', current: '', crumbs: [{ label: 'Not found' }], status: 404 },
    <>
      <PageHead title="You cannot open that page" />
      <p>
        <a href={homePath()} class={`text-link underline ${focus}`}>
          Go to Home
        </a>
      </p>
    </>,
  );
}
