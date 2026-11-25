import type { Child } from 'hono/jsx';
import { PageHead } from '../components/page-head.tsx';

export type Head = {
  readonly title: string;
  readonly eyebrow?: string | undefined;
  readonly lede?: Child | undefined;
  readonly actions?: Child | undefined;
  readonly titleField?: Child | undefined;
};

export function ShapeHead(props: { readonly head: Head; readonly document?: boolean | undefined }) {
  const { head } = props;
  return (
    <PageHead
      title={head.title}
      eyebrow={head.eyebrow}
      lede={head.lede}
      actions={head.actions}
      titleField={head.titleField}
      document={props.document}
      flush
    />
  );
}

export const page = 'mx-auto flex w-full max-w-content min-w-0 flex-col gap-7';
