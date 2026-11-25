import { TitleInput } from '@uw/ui/components/page-head.tsx';
import { fieldControl, fieldLabel } from '@uw/ui/components/field.tsx';

const BODY_ROWS = 24;

export function TitleField(props: {
  readonly pageId: string;
  readonly title: string;
  readonly placeholder?: string | undefined;
  readonly attrs?: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <TitleInput
      id={`title-${props.pageId}`}
      name="title"
      value={props.title}
      placeholder={props.placeholder}
      maxLength={200}
      attrs={props.attrs}
    />
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
