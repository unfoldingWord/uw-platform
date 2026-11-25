import type { Context } from 'hono';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen } from '../parts/frame.tsx';
import { homePath } from '../parts/paths.ts';
import { pageNames } from '../parts/names.ts';

export function notFound(c: Context<AppEnv>): Promise<Response> {
  return renderScreen(
    c,
    {
      title: pageNames.notFound,
      current: '',
      crumbs: [{ label: pageNames.notFound }],
      status: 404,
    },
    <ListShape head={{ title: 'You cannot open that page' }}>
      <EmptyState
        title="There is nothing to show here"
        text="The address may be wrong, or the page is not shared with you."
        action={
          <ButtonLink href={homePath()} variant="primary" icon="house">
            Go to Home
          </ButtonLink>
        }
      />
    </ListShape>,
  );
}
