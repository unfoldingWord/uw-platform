import type { Context } from 'hono';
import type { KernelOutcome, PersonaDashboard } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { idParam } from '../parts/params.ts';
import { Checks, JobCard } from '../parts/agent-card.tsx';
import { agentsPath } from '../parts/paths.ts';
import type { SavedToolset } from '../parts/persona-controls.tsx';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { Delegations, LastRuns, PersonaKpis } from '../parts/persona-figures.tsx';
import { notFound } from './not-found.tsx';
import { moduleCodes } from '../parts/names.ts';

export type PersonaRead = KernelOutcome<PersonaDashboard> | null;

export function pageIdOf(c: Context<AppEnv>): string | null {
  return idParam(c.req.param('pageId'));
}

export function readDashboard(read: PersonaRead): PersonaDashboard | null {
  return read?.status === 'accepted' ? read.value : null;
}

const statusWords: Readonly<Record<PersonaDashboard['page']['status'], string>> = {
  draft: 'Draft',
  suggested: 'Not live yet',
  active: 'Live',
  retired: 'Retired',
};

export async function renderPersona(
  c: Context<AppEnv>,
  dashboard: PersonaDashboard,
  saved: SavedToolset | null,
): Promise<Response> {
  const { page, harness } = dashboard;
  const screen = screenKernel(c);
  const waiting = screen === null ? 0 : await waitingCount(screen, harness.id);
  const spec = {
    title: page.title,
    current: agentsPath(harness.id),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(harness.title, agentsPath(harness.id), page.title),
    tabs: workflowTabs(harness.id, 'agents', waiting),
  };
  const owner =
    dashboard.frontmatter.owner === screen?.caller.actor.identity
      ? 'you'
      : dashboard.frontmatter.owner;
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow="Agent"
        title={page.title}
        lede={`${dashboard.persona} on ${harness.title} · owner ${owner} · today ${dashboard.today}`}
        actions={
          <Badge tone={page.status === 'active' ? 'success' : 'neutral'}>
            {statusWords[page.status]}
          </Badge>
        }
      />
      <div class="flex flex-col gap-5">
        <Checks dashboard={dashboard} />
        <JobCard dashboard={dashboard} requestId={crypto.randomUUID()} saved={saved} />
        <section>
          <h2 class="mt-0 mb-2 text-md font-heavy text-text">Today</h2>
          <PersonaKpis dashboard={dashboard} />
          <h2 class="mt-5 mb-2 text-md font-heavy text-text">Last runs</h2>
          <LastRuns dashboard={dashboard} />
          <h2 class="mt-5 mb-2 text-md font-heavy text-text">Standing permissions</h2>
          <Delegations dashboard={dashboard} />
        </section>
      </div>
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
