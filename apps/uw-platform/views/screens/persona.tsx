import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import { formatMoney } from '@uw/core/money';
import type { KernelOutcome, PersonaDashboard } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { fieldLabel } from '@uw/ui/components/field.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { idParam } from '../parts/params.ts';
import { Checks, JobCard } from '../parts/agent-card.tsx';
import { engineWord, runShapeWord } from '../parts/agent-words.ts';
import { agentsPath } from '../parts/paths.ts';
import type { SavedToolset } from '../parts/persona-controls.tsx';
import { waitingCount } from '../parts/waiting-count.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
import { Delegations, LastRuns, PersonaKpis } from '../parts/persona-figures.tsx';
import { notFound } from './not-found.tsx';
import { holdingOf, type Holding } from '../parts/holder.tsx';
import { shownIdentity, Who } from '../parts/person.tsx';
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

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function personaPeople(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  dashboard: PersonaDashboard,
): Promise<Holding> {
  const live = dashboard.delegations.live ?? [];
  return holdingOf(c.get('database')?.db ?? null, { reader: screen.caller.actor, at: screen.at }, [
    dashboard.frontmatter.owner,
    ...live.map((delegation) => `human:${delegation.personId}`),
  ]);
}

function Property(props: { readonly label: string; readonly children: Child }) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <p class={`m-0 ${fieldLabel}`}>{props.label}</p>
      <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm text-text">
        {props.children}
      </div>
    </div>
  );
}

function Owner(props: { readonly owner: string; readonly holding: Holding | null }) {
  const { holding } = props;
  if (holding === null) return null;
  return (
    <Property label="Owner">
      <Who
        reading={holding.reading}
        who={shownIdentity(props.owner, holding.names, (owner) => owner)}
      />
    </Property>
  );
}

function Rail(props: { readonly dashboard: PersonaDashboard; readonly holding: Holding | null }) {
  const { dashboard } = props;
  const { page, harness, frontmatter } = dashboard;
  return (
    <div class="grid grid-cols-2 gap-5 lg:grid-cols-1">
      <Property label="Status">
        <Badge tone={page.status === 'active' ? 'success' : 'neutral'}>
          {statusWords[page.status]}
        </Badge>
      </Property>
      <Owner owner={frontmatter.owner} holding={props.holding} />
      <Property label="Workflow">
        <a
          href={agentsPath(harness.id)}
          class={`font-semibold text-accent-text no-underline hover:underline ${focus}`}
        >
          {harness.title}
        </a>
      </Property>
      <Property label="Runs on">{runShapeWord(frontmatter.run_shape)}</Property>
      <Property label="Engine">{engineWord(frontmatter.engine)}</Property>
      <Property label="Model">
        <span class="font-mono break-all">{frontmatter.model}</span>
      </Property>
      <Property label="Monthly budget">
        {formatMoney({ amountMinor: frontmatter.budget.monthly_minor, currency: 'USD' })}
      </Property>
    </div>
  );
}

function Body(props: {
  readonly dashboard: PersonaDashboard;
  readonly holding: Holding | null;
  readonly saved: SavedToolset | null;
}) {
  const { dashboard, holding } = props;
  return (
    <>
      <Checks dashboard={dashboard} />
      <JobCard dashboard={dashboard} requestId={crypto.randomUUID()} saved={props.saved} />
      <Section title="Today">
        <PersonaKpis dashboard={dashboard} />
      </Section>
      <Section title="Last runs">
        <LastRuns dashboard={dashboard} />
      </Section>
      <Section title="Standing permissions" sub="Let it work without someone starting each run">
        {holding === null ? null : <Delegations dashboard={dashboard} holding={holding} />}
      </Section>
    </>
  );
}

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
  const holding = screen === null ? null : await personaPeople(c, screen, dashboard);
  return renderScreen(
    c,
    spec,
    <DocumentShape
      head={{
        eyebrow: 'Agent',
        title: page.title,
        lede: `${dashboard.persona} on ${harness.title} · today ${dashboard.today}`,
      }}
      rail={<Rail dashboard={dashboard} holding={holding} />}
    >
      <Body dashboard={dashboard} holding={holding} saved={saved} />
    </DocumentShape>,
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
