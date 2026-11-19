import { evidenceDefinitions, type EvidenceLabelValue } from './evidence-labels.ts';

const word =
  'inline-flex items-center rounded-sm bg-hover px-1 text-xs leading-normal font-heavy text-text-3';

export function EvidenceLabel(props: {
  readonly label: EvidenceLabelValue;
  readonly showDefinition?: boolean;
}) {
  const definition = evidenceDefinitions[props.label];
  if (props.showDefinition === true) {
    return (
      <span class="inline-flex flex-wrap items-center gap-2">
        <span class={word}>{props.label}</span>
        <span class="text-xs text-text-3">{definition}</span>
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
