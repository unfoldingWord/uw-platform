import { Button, ButtonLink } from '@uw/ui/components/button.tsx';
import { HumanSubmit } from '@uw/ui/components/human-action.tsx';
import { PageBand } from './page-read.tsx';

function DraftMode(props: { readonly drafting: boolean }) {
  return (
    <span class="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        class="size-size-1 rounded-full bg-text-3 group-data-draft-live/edit:bg-ok"
      ></span>
      <span data-editor-mode="" role="status" aria-live="polite">
        {props.drafting ? 'Joining the working draft' : 'Editing on your own'}
      </span>
    </span>
  );
}

function Status(props: { readonly drafting: boolean }) {
  return (
    <>
      <DraftMode drafting={props.drafting} />
      <span
        data-editor-people=""
        role="status"
        aria-live="polite"
        class="text-sm text-text-3 empty:hidden"
      ></span>
    </>
  );
}

function Leave(props: { readonly read: string }) {
  return (
    <ButtonLink href={props.read} variant="ghost" attrs={{ 'data-leave-edit': '' }}>
      Cancel
      <span class="sr-only">. Back to reading</span>
      <kbd class="hidden rounded-sm border border-line px-1 font-mono text-xs text-text-3 md:inline">
        Esc
      </kbd>
    </ButtonLink>
  );
}

export function EditBar(props: { readonly read: string; readonly drafting: boolean }) {
  return (
    <PageBand
      attrs={{ 'data-edit-bar': '' }}
      status={<Status drafting={props.drafting} />}
      actions={
        <>
          <Button variant="ghost" attrs={{ 'data-editor-discard': '', hidden: true }}>
            Discard draft
          </Button>
          <Leave read={props.read} />
          <HumanSubmit label="Save" icon="check" />
        </>
      }
    />
  );
}
