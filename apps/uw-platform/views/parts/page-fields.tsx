import { fieldControl, fieldLabel } from '@uw/ui/components/field.tsx';

const BODY_ROWS = 24;

export function TitleField(props: { readonly pageId: string; readonly title: string }) {
  const id = `title-${props.pageId}`;
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <label for={id} class={fieldLabel}>
        Title
      </label>
      <input
        id={id}
        name="title"
        type="text"
        value={props.title}
        maxLength={200}
        required
        class={`${fieldControl} w-full`}
      />
    </div>
  );
}

export function BodyField(props: { readonly pageId: string; readonly bodyMd: string }) {
  const id = `body-${props.pageId}`;
  return (
    <div data-editor-text="" class="flex min-w-0 flex-col gap-1">
      <label for={id} class={fieldLabel}>
        Text
      </label>
      <textarea
        id={id}
        name="bodyMd"
        rows={BODY_ROWS}
        maxLength={1_000_000}
        class={`${fieldControl} w-full resize-y font-mono`}
      >
        {props.bodyMd}
      </textarea>
    </div>
  );
}

export function EditorStatus() {
  return (
    <p
      data-editor-status=""
      role="status"
      aria-live="polite"
      class="m-0 text-sm text-text-3 empty:hidden"
    ></p>
  );
}
