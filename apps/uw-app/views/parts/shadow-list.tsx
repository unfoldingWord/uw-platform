import type { ShadowComparison, ShadowRow } from '@uw/contracts';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Table, type Column } from '@uw/ui/components/table.tsx';
import { domId, reasonText } from '@uw/ui/components/text.ts';
import { pullRequestUrl, shadowExportPath } from './paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

const columns: readonly Column[] = [
  { key: 'pull', label: 'Pull request' },
  { key: 'head', label: 'Head' },
  { key: 'shadow', label: 'Shadow verdict' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'github', label: 'Other reviews on this head' },
  { key: 'agreement', label: 'Agreement' },
];

function verdictText(row: ShadowRow): string {
  if (row.shadow === null) return 'No verdict yet';
  if (row.shadow.verdict === 'advance') return 'Would advance';
  return `Would refuse: ${row.shadow.reasons.map(reasonText).join(', ')}`;
}

function reviewerText(row: ShadowRow): string {
  if (row.reviewer === null) return 'No verdict recorded';
  const verdict = row.reviewer.verdict === 'approve' ? 'approve' : 'request changes';
  return `${row.reviewer.reviewer}: ${verdict}`;
}

function githubText(row: ShadowRow): string {
  if (row.github.length === 0) return 'None';
  return row.github
    .map((review) => `${review.reviewer}: ${review.state.replaceAll('_', ' ')}`)
    .join('; ');
}

function agreementCell(row: ShadowRow) {
  if (row.disagrees) return <Badge tone="info">Disagree</Badge>;
  return row.reviewer === null || row.github.length === 0 ? 'Not compared' : 'Agree';
}

function rowOf(row: ShadowRow) {
  const pull = `${row.pullRequest.repo}#${row.pullRequest.number}`;
  return {
    pull: (
      <a href={pullRequestUrl(row.pullRequest)} class={`text-link underline ${focus}`}>
        {pull}
      </a>
    ),
    head: <span class="font-mono">{row.head.slice(0, 12)}</span>,
    shadow: (
      <span class="flex flex-wrap items-center gap-2">
        <Badge tone="held">shadow</Badge>
        <span>{verdictText(row)}</span>
      </span>
    ),
    reviewer: reviewerText(row),
    github: githubText(row),
    agreement: agreementCell(row),
  };
}

export function ShadowList(props: { readonly comparison: ShadowComparison }) {
  const { comparison } = props;
  const headingId = domId('shadow', comparison.harnessId);
  const caption = `Shadow verdicts on ${comparison.harnessKey}`;
  return (
    <section aria-labelledby={headingId} class="flex flex-col gap-2">
      <h2 id={headingId} class="m-0 text-base font-bold text-ink">
        {caption}
      </h2>
      <p class="m-0">
        <a href={shadowExportPath(comparison.harnessId)} class={`text-link underline ${focus}`}>
          {`Export the shadow verdicts for ${comparison.harnessKey}`}
        </a>
      </p>
      {comparison.rows.length === 0 ? (
        <Note>No shadow verdict has been recorded on this harness yet.</Note>
      ) : (
        <Table caption={caption} columns={columns} rows={comparison.rows.map(rowOf)} />
      )}
    </section>
  );
}
