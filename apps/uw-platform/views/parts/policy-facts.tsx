import { formatInstant } from '@uw/core/dates';
import { Note } from '@uw/ui/components/note.tsx';
import type { PolicyReading, ShownConflict } from '../../pages/policy-reading.ts';
import type { PendingSuggestion } from '../../pages/suggestions.ts';
import type { Fact } from './page-read.tsx';
import { pageLink } from './page-shown.ts';
import { pagePath, pageSuggestionPath } from './paths.ts';

export const levelWords: Readonly<Record<PolicyReading['level'], string>> = {
  organization: 'Whole organization',
  portfolio: 'Portfolio',
  program: 'Program',
  project: 'Project',
  product: 'Product',
};

const enforcementWords: Readonly<Record<PolicyReading['enforcement'], string>> = {
  required: 'Required: holds below whatever a lower policy says',
  default: 'Default: a lower policy may replace it',
  template: 'Template: copied into what is made from it',
};

export const enforcementLabels: Readonly<Record<PolicyReading['enforcement'], string>> = {
  required: 'Required',
  default: 'Default',
  template: 'Template',
};

export function inForceWords(reading: Pick<PolicyReading, 'effectiveFrom' | 'effectiveUntil'>) {
  return reading.effectiveUntil === null
    ? `From ${reading.effectiveFrom}`
    : `From ${reading.effectiveFrom} until ${reading.effectiveUntil}`;
}

export function TargetLink(props: { readonly reading: PolicyReading }) {
  const { target, level } = props.reading;
  if (level === 'organization') return <span>Everyone</span>;
  if (target === null) return <span>A page you cannot read</span>;
  return (
    <a href={pagePath(target.id)} class={pageLink}>
      {target.title}
    </a>
  );
}

function sourceWords(copied: NonNullable<PolicyReading['copiedFrom']>): string {
  const from = `version ${String(copied.version)}`;
  if (copied.current === null) return `Copied from ${from}`;
  if (copied.current > copied.version) {
    return `Copied from ${from}; the template is now at version ${String(copied.current)}`;
  }
  return `Copied from ${from}, the current version`;
}

export function policyFacts(reading: PolicyReading): readonly Fact[] {
  const facts: Fact[] = [
    { label: 'Level', value: levelWords[reading.level] },
    { label: 'Applies to', value: <TargetLink reading={reading} /> },
    { label: 'Enforcement', value: enforcementWords[reading.enforcement] },
    { label: 'In force', value: inForceWords(reading) },
  ];
  const copied = reading.copiedFrom;
  if (copied !== null) {
    const source =
      copied.page === null ? (
        sourceWords(copied)
      ) : (
        <a href={pagePath(copied.page.id)} class={pageLink}>
          {sourceWords(copied)}
        </a>
      );
    facts.push({ label: 'Template', value: source });
  }
  return facts;
}

const conflictWords: Readonly<Record<ShownConflict['why'], string>> = {
  required_holds: 'is required, so it still holds',
  not_a_descendant: 'is not above it, so the replacement has no effect',
};

export function PolicyConflicts(props: { readonly conflicts: readonly ShownConflict[] }) {
  if (props.conflicts.length === 0) return null;
  return (
    <div data-policy-conflicts="" class="flex flex-col gap-2">
      {props.conflicts.map((conflict) => (
        <Note>
          <a href={pagePath(conflict.by.id)} class={pageLink}>
            {conflict.by.title}
          </a>
          {' tries to replace '}
          <a href={pagePath(conflict.over.id)} class={pageLink}>
            {conflict.over.title}
          </a>
          {`, which ${conflictWords[conflict.why]}.`}
        </Note>
      ))}
    </div>
  );
}

export function SuggestionsWaiting(props: {
  readonly pageId: string;
  readonly suggestions: readonly PendingSuggestion[];
}) {
  if (props.suggestions.length === 0) return null;
  return (
    <div data-suggestions-waiting="" class="flex flex-col gap-2">
      {props.suggestions.map((suggestion) => (
        <Note>
          {`An agent suggested a change on ${formatInstant(suggestion.proposedAt)}. `}
          <a href={pageSuggestionPath(props.pageId, suggestion.id)} class={pageLink}>
            Review the suggested change
          </a>
        </Note>
      ))}
    </div>
  );
}
