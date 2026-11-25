import type { Context } from 'hono';
import { setAreaHomeCommandSchema, type ErrorReason, type Page } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { Button } from '@uw/ui/components/button.tsx';
import { Hairline, Section } from '@uw/ui/components/section.tsx';
import { FormActions } from '@uw/ui/shapes/form.tsx';
import type { AppEnv } from '../../deps.ts';
import { homePageOf, setAreaHome } from '../../pages/area-homes.ts';
import type { ScreenKernel } from './frame.tsx';
import { pageManagePath } from './paths.ts';

export type HomeState = { readonly admin: boolean; readonly isHome: boolean };

export async function homeStateOf(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  page: Page,
): Promise<HomeState> {
  const database = c.get('database');
  const admin = can(screen.caller.actor, 'admin', { kind: 'area', area: page.jdArea }, screen.at);
  if (!admin || database === null) return { admin, isHome: false };
  return { admin, isHome: (await homePageOf(database.db, page.jdArea)) === page.id };
}

export function AreaHomeCard(props: { readonly page: Page; readonly state: HomeState }) {
  const { page, state } = props;
  if (!state.admin) return null;
  return (
    <>
      <Hairline />
      <Section
        title="Area home"
        sub={
          state.isHome
            ? `This is the home page of area ${page.jdArea}`
            : `Shown first when someone opens area ${page.jdArea}`
        }
      >
        <form method="post" action={pageManagePath(page.id)} class="flex flex-col gap-4">
          <input type="hidden" name="intent" value="home" />
          <input type="hidden" name="requestId" value={crypto.randomUUID()} />
          <input type="hidden" name="home" value={state.isHome ? 'clear' : 'set'} />
          <FormActions>
            <Button type="submit">
              {state.isHome ? 'Stop using it as the home page' : 'Make it the home page'}
            </Button>
          </FormActions>
        </form>
      </Section>
    </>
  );
}

export async function changeAreaHome(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  page: Page,
  posted: Readonly<Record<string, unknown>>,
): Promise<ErrorReason | null> {
  const database = c.get('database');
  const command = setAreaHomeCommandSchema.safeParse({
    command: 'set_area_home',
    requestId: posted['requestId'],
    area: page.jdArea,
    pageId: posted['home'] === 'clear' ? null : page.id,
  });
  if (!command.success || database === null) return 'malformed_command';
  const done = await setAreaHome(database.db, screen.caller.actor, command.data, screen.at);
  return done.ok ? null : done.reason;
}
