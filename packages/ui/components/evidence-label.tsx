import { evidenceDefinitions, type EvidenceLabelValue } from './evidence-labels.ts';

export function EvidenceLabel(props: { readonly label: EvidenceLabelValue }) {
  return (
    <span
      title={evidenceDefinitions[props.label]}
      class="inline-flex items-center rounded-sm border border-line bg-bg px-2 py-0.5 text-xs font-bold text-muted"
    >
      {props.label}
      <span class="sr-only"> ({evidenceDefinitions[props.label]})</span>
    </span>
  );
}
