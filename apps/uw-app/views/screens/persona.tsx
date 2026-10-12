import type { Context } from 'hono';
import type { KernelOutcome, PersonaDashboard } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { idParam } from '../parts/params.ts';
import { flowPath, homePath, personaPath } from '../parts/paths.ts';
import { ActivateForm, ToolsetForm, type SavedToolset } from '../parts/persona-controls.tsx';
import { Delegations, LastRuns, PersonaKpis } from '../parts/persona-figures.tsx';
import { notFound } from './not-found.tsx';

export type PersonaRead = KernelOutcome<PersonaDashboard> | null;

export function pageIdOf(c: Context<AppEnv>): string | null {
  return idParam(c.req.param('pageId'));
}

export function readDashboard(read: PersonaRead): PersonaDashboard | null {
  return read?.status === 'accepted' ? read.value : null;
}

function statusText(dashboard: PersonaDashboard): string {
  return dashboard.page.status === 'active' ? 'Active' : 'Suggested';
}

export function renderPersona(
  c: Context<AppEnv>,
  dashboard: PersonaDashboard,
  saved: SavedToolset | null,
): Promise<Response> {
  const { page, harness } = dashboard;
  const spec = {
    title: page.title,
    current: personaPath(page.id),
    crumbs: [
      { label: 'Home', href: homePath() },
      { label: harness.key, href: flowPath(harness.id) },
      { label: 'Persona' },
    ],
  };
  const options = dashboard.toolsetOptions;
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow="Persona"
        title={page.title}
        lede={`${dashboard.persona} on ${harness.key}, today ${dashboard.today}`}
        actions={
          <Badge tone={page.status === 'active' ? 'success' : 'neutral'}>
            {statusText(dashboard)}
          </Badge>
        }
      />
      {dashboard.canActivate ? <ActivateForm dashboard={dashboard} /> : null}
      <PersonaKpis dashboard={dashboard} />
      <h2 class="mb-2 text-lg font-bold text-ink">Last runs</h2>
      <LastRuns dashboard={dashboard} />
      <h2 class="mb-2 text-lg font-bold text-ink">Delegations</h2>
      <Delegations dashboard={dashboard} />
      {options === null ? null : (
        <ToolsetForm
          dashboard={dashboard}
          options={options}
          requestId={crypto.randomUUID()}
          saved={saved}
        />
      )}
    </>,
  );
}

export async function personaScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const pageId = pageIdOf(c);
  const read = { at: screen.at };
  const dashboard = readDashboard(
    pageId === null ? null : await screen.kernel.views.persona(screen.caller, { pageId }, read),
  );
  return dashboard === null ? notFound(c) : renderPersona(c, dashboard, null);
}
