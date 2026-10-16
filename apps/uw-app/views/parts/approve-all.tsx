import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';

export type Approvable = {
  readonly harnessId: string;
  readonly harnessKey: string;
  readonly entries: readonly { readonly itemId: string; readonly head: string }[];
  readonly total: number;
};

function labelOf(batch: Approvable): string {
  const count = batch.entries.length;
  if (batch.total > count) {
    return `Approve the first ${count} of ${batch.total} gates shown on ${batch.harnessKey}`;
  }
  return count === 1
    ? `Approve the 1 gate shown on ${batch.harnessKey}`
    : `Approve all ${count} gates shown on ${batch.harnessKey}`;
}

export function ApproveAll(props: { readonly batch: Approvable }) {
  const { batch } = props;
  const value = batch.entries.map((entry) => `${entry.itemId}:${entry.head}`).join(',');
  return (
    <CommandForm harnessId={batch.harnessId} command="decide_gates">
      <input type="hidden" name="entries" value={value} />
      <HumanActionButton
        itemId={batch.harnessId}
        label={labelOf(batch)}
        name="decision"
        value="approve"
      />
    </CommandForm>
  );
}
