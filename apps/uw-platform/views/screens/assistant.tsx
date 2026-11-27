import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { AssistantOverview } from '@uw/harness';
import { can } from '@uw/core/acl';
import { Note } from '@uw/ui/components/note.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { FormShape } from '@uw/ui/shapes/form.tsx';
import type { AppEnv } from '../../deps.ts';
import { accountsSummary, type AccountsSummary } from '../../assistants/summary.ts';
import { startZulipPairing } from '../../assistants/zulip/pairing-start.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { Accounts, Budget, Permission, TurnOff, TurnOn } from '../parts/my-assistant-setup.tsx';
import { History, Proposals, Reminders, Requests, Settings } from '../parts/my-assistant-work.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { myAssistantPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const lede =
  'Your own assistant: it answers your direct messages, sets your reminders and holds time on your calendar, only for you.';
const adminLede =
  'An admin sees this assistant’s accounts and budget, never what its person asked.';

type Shown = {
  readonly overview: AssistantOverview;
  readonly summary: AccountsSummary | null;
  readonly admin: boolean;
  readonly notice: string | null;
};

function isOn(overview: AssistantOverview): boolean {
  return overview.account?.status === 'enabled';
}

function OwnBody(props: { readonly shown: Shown }) {
  const { overview, summary, admin } = props.shown;
  if (!isOn(overview) || summary === null) return <TurnOn overview={overview} />;
  return (
    <>
      <Accounts overview={overview} summary={summary} />
      <Permission overview={overview} />
      <Budget overview={overview} admin={admin} />
      <Proposals />
      <Requests overview={overview} />
      <Reminders overview={overview} />
      <Settings overview={overview} />
      <History />
      <TurnOff />
    </>
  );
}

function AdminBody(props: { readonly shown: Shown }) {
  const { overview, summary } = props.shown;
  if (overview.account === null || summary === null) {
    return <p class="m-0 text-sm text-text-3">This person has not turned on an assistant.</p>;
  }
  return (
    <>
      <Accounts overview={overview} summary={summary} />
      <Budget overview={overview} admin />
    </>
  );
}

function render(c: Context<AppEnv>, shown: Shown): Promise<Response> {
  const { overview } = shown;
  const title = overview.self ? pageNames.myAssistant : (overview.title ?? pageNames.myAssistant);
  const body: Child = overview.self ? <OwnBody shown={shown} /> : <AdminBody shown={shown} />;
  return renderScreen(
    c,
    {
      title,
      current: myAssistantPath(),
      code: moduleCodes.myAssistant,
      crumbs: [{ label: pageNames.myAssistant }],
    },
    <FormShape
      head={{
        eyebrow: overview.account?.jdId ?? 'Personal assistant',
        title,
        lede: overview.self ? lede : adminLede,
      }}
    >
      {shown.notice === null ? null : <Note>{shown.notice}</Note>}
      <p data-outcome-keep role="status" aria-live="polite" class="m-0 text-sm text-text-3"></p>
      {body}
    </FormShape>,
  );
}

type Seen = Awaited<ReturnType<ScreenKernel['kernel']['views']['myAssistant']>>;

async function shownOf(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  outcome: Seen,
): Promise<Shown | null> {
  const database = c.get('database');
  if (outcome.status !== 'accepted' || database === null) return null;
  const overview = outcome.value;
  const summary =
    overview.harnessId === null ? null : await accountsSummary(database.db, overview.harnessId);
  const admin = can(screen.caller.actor, 'admin', { kind: 'org' }, screen.at);
  return { overview, summary, admin, notice: null };
}

export async function myAssistantScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const asked = c.req.query('person');
  const personId = asked === undefined ? null : idParam(asked);
  if (asked !== undefined && personId === null) return notFound(c);
  const outcome = await screen.kernel.views.myAssistant(screen.caller, { personId });
  const shown = await shownOf(c, screen, outcome);
  return shown === null ? notFound(c) : render(c, shown);
}

function pairingNotice(code: string): string {
  return `Send this code to your assistant in a Zulip direct message within ten minutes: ${code}`;
}

export async function startPairingForm(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const outcome = await screen.kernel.views.myAssistant(screen.caller, { personId: null });
  const shown = await shownOf(c, screen, outcome);
  if (shown === null) return notFound(c);
  const harnessId = shown.overview.harnessId;
  if (harnessId === null || !isOn(shown.overview)) {
    return render(c, { ...shown, notice: reasonText('no_assistant') });
  }
  const started = await startZulipPairing(screen.kernel, screen.caller, harnessId);
  const notice =
    started.status === 'accepted' ? pairingNotice(started.value.code) : reasonText(started.reason);
  return render(c, { ...shown, notice });
}
