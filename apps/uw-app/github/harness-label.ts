export const HARNESS_LABEL = 'harness';

export function carriesHarnessLabel(labels: readonly string[]): boolean {
  return labels.some((label) => label.toLowerCase() === HARNESS_LABEL);
}
