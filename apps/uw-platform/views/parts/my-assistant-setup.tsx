import { ASSISTANT_DELETE_AFTER_DAYS, type AssistantProvisioningStep } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { formatMoney } from '@uw/core/money';
import type { AssistantOverview } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Button } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Kpi } from '@uw/ui/components/kpi.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AccountsSummary } from '../../assistants/summary.ts';
import { myAssistantPairingPath } from './paths.ts';
import { EndsField } from './standing-permissions.tsx';

export const ASSISTANT_ENDPOINT = '/api/assistant/commands';
const BUDGET_ENDPOINT = '/api/acl/commands';
const NAME_MOST = 30;

const nameHint =
  'Lowercase letters, digits, dots and hyphens, 2 to 30 characters. It becomes the mailbox address and the Zulip bot name, so a name a person, a group or another assistant already uses is taken.';

const stepWords: Readonly<Record<AssistantProvisioningStep, string>> = {
  workspace_user: 'Creating its mailbox',
  zulip_bot: 'Creating its Zulip bot',
  persona: 'Activating its persona',
  assist: 'Waiting for your permission',
  suspend_user: 'Suspending its mailbox',
  deactivate_bot: 'Deactivating its Zulip bot',
  delete_user: 'Deleting its mailbox',
};

export function TurnOn(props: { readonly overview: AssistantOverview }) {
  const { account } = props.overview;
  const off = account?.status === 'disabled' && account.disabledAt !== null;
  return (
    <Section title="Turn on your assistant">
      {off ? (
        <p class="m-0 text-sm text-text-3">
          {`It was turned off on ${formatDate(account.disabledAt)}. Turning it on within ${String(ASSISTANT_DELETE_AFTER_DAYS)} days restores its mailbox, its bot and its number.`}
        </p>
      ) : (
        <p class="m-0 text-sm text-text-3">
          Your assistant gets its own mailbox, its own Zulip bot and its own number. It acts only
          for you, and only after you give it permission.
        </p>
      )}
      <PlatformCommandForm
        endpoint={ASSISTANT_ENDPOINT}
        command="enable_assistant"
        scope="assistant"
        done="Turned on. Its accounts are being set up."
      >
        <TextField
          name="name"
          label="Name"
          scope="assistant"
          value={account?.name ?? ''}
          required
          maxLength={NAME_MOST}
          placeholder="barnabas"
          hint={nameHint}
        />
        <Button type="submit" variant="human">
          Turn on your assistant
        </Button>
      </PlatformCommandForm>
    </Section>
  );
}

function progressText(summary: AccountsSummary): string {
  const { progress } = summary;
  if (progress === null) return 'Not started';
  if (progress.status === 'done') return 'Ready';
  if (progress.status === 'failed' || progress.failure !== null) {
    return `${stepWords[progress.step]}: ${reasonText(progress.failure ?? 'failed')}`;
  }
  return stepWords[progress.step];
}

function Pairing(props: { readonly overview: AssistantOverview }) {
  const { paired, self } = props.overview;
  if (paired !== null) {
    const how = paired.via === 'email_match' ? 'by your email' : 'with a code';
    return <p class="m-0 text-sm text-text-3">{`Your Zulip account is paired ${how}.`}</p>;
  }
  if (!self) return <p class="m-0 text-sm text-text-3">No Zulip account is paired yet.</p>;
  return (
    <form method="post" action={myAssistantPairingPath()} class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-text-3">Your Zulip account is not paired yet.</span>
      <Button type="submit" size="sm">
        Get a pairing code
      </Button>
    </form>
  );
}

export function Accounts(props: {
  readonly overview: AssistantOverview;
  readonly summary: AccountsSummary;
}) {
  const { overview, summary } = props;
  const mailbox = summary.mailbox;
  const bot = summary.bot;
  return (
    <Section title="Accounts" sub={progressText(summary)}>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Kpi label="Number" value={overview.account?.jdId ?? 'None'} plain />
        <Kpi
          label="Mailbox"
          value={mailbox?.address ?? 'Not created yet'}
          detail={mailbox === null ? undefined : reasonText(mailbox.status)}
          plain
        />
        <Kpi
          label="Zulip bot"
          value={bot?.fullName ?? 'Not created yet'}
          detail={bot === null ? undefined : `${bot.email} · ${reasonText(bot.status)}`}
          plain
        />
      </div>
      <Pairing overview={overview} />
    </Section>
  );
}

function GrantOrRenew(props: { readonly renew: boolean }) {
  const command = props.renew ? 'renew_assist' : 'grant_assist';
  return (
    <PlatformCommandForm
      endpoint={ASSISTANT_ENDPOINT}
      command={command}
      scope="assistant"
      done={props.renew ? 'Renewed.' : 'Granted.'}
    >
      <EndsField scope={command} />
      <Button type="submit" variant={props.renew ? 'secondary' : 'human'}>
        {props.renew ? 'Renew' : 'Give permission'}
      </Button>
    </PlatformCommandForm>
  );
}

export function Permission(props: { readonly overview: AssistantOverview }) {
  const { assist } = props.overview;
  return (
    <Section title="Permission" sub="It acts only while this lasts">
      {assist === null ? (
        <p class="m-0 text-sm text-text-3">
          Your assistant may not act for you now. With no end date, permission lasts 90 days.
        </p>
      ) : (
        <p class="m-0 text-sm text-text">
          {`Your assistant may act for you until ${formatDate(assist.expiresAt)}.`}
        </p>
      )}
      <GrantOrRenew renew={assist !== null} />
      {assist === null ? null : (
        <PlatformCommandForm
          endpoint={ASSISTANT_ENDPOINT}
          command="revoke_assist"
          scope="assistant"
          done="Revoked."
        >
          <Button type="submit" size="sm">
            Revoke
          </Button>
        </PlatformCommandForm>
      )}
    </Section>
  );
}

function money(minor: number): string {
  return formatMoney({ amountMinor: minor, currency: 'USD' });
}

function BudgetForm(props: { readonly personId: string }) {
  return (
    <PlatformCommandForm
      endpoint={BUDGET_ENDPOINT}
      command="set_assistant_budget"
      scope={props.personId}
      done="Budget set."
    >
      <input type="hidden" name="personId" value={props.personId} />
      <TextField
        name="monthlyDollars"
        label="Monthly budget in USD"
        scope={props.personId}
        maxLength={10}
        placeholder="20.00"
        hint="Leave it blank for the default."
      />
      <Button type="submit">Set budget</Button>
    </PlatformCommandForm>
  );
}

export function Budget(props: { readonly overview: AssistantOverview; readonly admin: boolean }) {
  const { budget, personId } = props.overview;
  const detail = budget.overridden ? 'Set by an admin' : 'The default';
  return (
    <Section title="Budget" sub="This month">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Kpi label="Spent" value={money(budget.spentMinor)} plain />
        <Kpi label="Monthly budget" value={money(budget.monthlyMinor)} detail={detail} plain />
      </div>
      {budget.spentMinor >= budget.monthlyMinor ? (
        <Badge tone="held">Spent: it answers again next month</Badge>
      ) : null}
      {props.admin ? <BudgetForm personId={personId} /> : null}
    </Section>
  );
}

export function TurnOff() {
  return (
    <Section title="Turn off">
      <p class="m-0 text-sm text-text-3">
        {`Turning it off suspends its mailbox and its bot at once and ends its permission. Turn it on again within ${String(ASSISTANT_DELETE_AFTER_DAYS)} days to restore them; after that its mailbox is deleted.`}
      </p>
      <PlatformCommandForm
        endpoint={ASSISTANT_ENDPOINT}
        command="disable_assistant"
        scope="assistant"
        done="Turned off."
      >
        <Button type="submit">Turn off your assistant</Button>
      </PlatformCommandForm>
    </Section>
  );
}

export function AdminTurnOff(props: { readonly overview: AssistantOverview }) {
  const { personId, account } = props.overview;
  if (account?.status !== 'enabled') return null;
  return (
    <Section title="Turn off">
      <p class="m-0 text-sm text-text-3">
        {`For someone who has left or should no longer have an assistant. It ends its permission at once, and within a minute its mailbox and its bot are suspended. Its person can turn it on again within ${String(ASSISTANT_DELETE_AFTER_DAYS)} days; after that its mailbox is deleted.`}
      </p>
      <PlatformCommandForm
        endpoint={BUDGET_ENDPOINT}
        command="disable_person_assistant"
        scope={`${personId}-off`}
        done="Turned off."
      >
        <input type="hidden" name="personId" value={personId} />
        <Button type="submit">Turn off this assistant</Button>
      </PlatformCommandForm>
    </Section>
  );
}
