import { shipRefusalSchema, type GateView, type ShipRefusal } from '@uw/contracts';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { failingReasons } from './ship-input.tsx';

const ruleTable: Readonly<Record<ShipRefusal, string>> = {
  pr_not_open: 'Pull request open',
  pr_is_draft: 'Not a draft',
  head_mismatch: 'Head matches',
  checks_not_green: 'Checks green',
  no_reviewer_approval: 'Reviewer approved',
  risk_tier_undeclared: 'Tier declared',
  reviewer_count_below_tier: 'Enough reviewers for the tier',
  reviewer_providers_not_distinct: 'Reviewers from distinct providers',
  approver_lacks_domain_grant: 'Your grant covers the domains',
  base_behind: 'Base current',
  auto_close_keyword: 'No auto-close keyword',
  skip_ci_marker: 'No skip-CI marker',
  required_check_never_ran: 'Every required check ran',
  harness_frozen: 'Not frozen',
  protected_path_needs_person: 'No protected path needs a person',
  tier_above_delegation: 'Tier within the delegation',
};

const ruleWords = new Map(Object.entries(ruleTable));
const wordsOf = (rule: ShipRefusal): string => ruleWords.get(rule) ?? reasonText(rule);

export const RULE_COUNT = shipRefusalSchema.options.length;

export function rulesMet(view: GateView): number {
  return RULE_COUNT - failingReasons(view).length;
}

const SEGMENT = 0.8;

export function RulesRing(props: { readonly met: number }) {
  const segments = shipRefusalSchema.options.map((_rule, index) => index);
  return (
    <div class="flex items-center gap-3">
      <svg viewBox="0 0 48 48" class="size-size-7 -rotate-90" aria-hidden="true">
        {segments.map((index) => (
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke-width="5"
            pathLength={RULE_COUNT}
            stroke-dasharray={`${SEGMENT} ${RULE_COUNT - SEGMENT}`}
            stroke-dashoffset={-index}
            class={index < props.met ? 'stroke-ok' : 'stroke-line-strong'}
          />
        ))}
      </svg>
      <p class="m-0 flex flex-col leading-tight">
        <span class="font-mono text-2xl text-text">
          {props.met}
          <span class="text-md text-text-3">/{RULE_COUNT}</span>
        </span>
        <span class="text-xs text-text-3">rules met</span>
      </p>
    </div>
  );
}

function Row(props: { readonly title: string; readonly detail: string; readonly met: boolean }) {
  return (
    <li class="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Icon
        name={props.met ? 'check' : 'clock'}
        size={2}
        class={props.met ? 'text-ok-text' : 'text-text-3'}
      />
      <div class="min-w-0 flex-1">
        <p class="m-0 text-sm font-semibold text-text">{props.title}</p>
        <p class="m-0 text-xs text-text-3">{props.detail}</p>
      </div>
      <Badge tone={props.met ? 'success' : 'held'}>{props.met ? 'Met' : 'Not met'}</Badge>
    </li>
  );
}

export function ShipRules(props: { readonly view: GateView }) {
  if (props.view.ship === null) return null;
  const failing = failingReasons(props.view);
  const met = shipRefusalSchema.options.filter((rule) => !failing.includes(rule));
  return (
    <section aria-label="Ship rule" class="flex flex-col gap-2">
      <p class="m-0 text-sm">
        <span class="font-heavy text-text">Ship rule</span>
        <span class="ml-2 text-xs text-text-3">checked against the head below</span>
      </p>
      <ul class="m-0 list-none rounded-lg bg-raised p-0 shadow-1">
        {failing.map((rule) => (
          <Row title={wordsOf(rule)} detail={reasonText(rule)} met={false} />
        ))}
        {met.length === 0 ? null : (
          <Row
            title={`${met.length} ${failing.length === 0 ? '' : 'other '}rules met`}
            detail={met.map(wordsOf).join(', ')}
            met
          />
        )}
      </ul>
    </section>
  );
}
