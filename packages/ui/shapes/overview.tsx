import type { Child } from 'hono/jsx';
import { ShapeHead, page, type Head } from './head.tsx';

export function OverviewShape(props: {
  readonly head: Head;
  readonly figures?: Child | undefined;
  readonly side?: Child | undefined;
  readonly children?: Child | undefined;
}) {
  return (
    <div data-shape="overview" class={page}>
      <ShapeHead head={props.head} />
      {props.figures === undefined ? null : <Figures>{props.figures}</Figures>}
      {props.side === undefined ? (
        <div class="flex min-w-0 flex-col gap-7">{props.children}</div>
      ) : (
        <div class="grid grid-cols-1 gap-7 lg:grid-cols-overview">
          <div class="flex min-w-0 flex-col gap-7">{props.children}</div>
          <div class="flex min-w-0 flex-col gap-7">{props.side}</div>
        </div>
      )}
    </div>
  );
}

export function Figures(props: { readonly children?: Child }) {
  return <div class="grid grid-cols-figures gap-4">{props.children}</div>;
}
