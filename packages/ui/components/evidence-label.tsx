import { evidenceDefinitions, type EvidenceLabelValue } from './evidence-labels.ts';

const word =
  'inline-flex items-center rounded-sm border border-line bg-bg px-2 py-0.5 text-xs font-bold text-muted';

export function EvidenceLabel(props: {
  readonly label: EvidenceLabelValue;
  readonly showDefinition?: boolean;
}) {
  const definition = evidenceDefinitions[props.label];
  if (props.showDefinition === true) {
    return (
      <span class="inline-flex flex-wrap items-center gap-2">
        <span class={word}>{props.label}</span>
        <span class="text-xs text-muted">{definition}</span>
      </span>
    );
  }
  return (
    <span title={definition} class={word}>
      {props.label}
      <span class="sr-only"> ({definition})</span>
    </span>
  );
}
