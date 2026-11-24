import type { Child } from 'hono/jsx';
import type { Layout } from '@uw/contracts';
import { BoardLayout } from './collection-board.tsx';
import { CalendarLayout, ChartLayout } from './collection-calendar.tsx';
import { GalleryLayout, ListLayout, TableLayout, type LayoutProps } from './collection-layouts.tsx';

const layouts: ReadonlyMap<Layout, (props: LayoutProps) => Child> = new Map<
  Layout,
  (props: LayoutProps) => Child
>([
  ['table', TableLayout],
  ['board', BoardLayout],
  ['list', ListLayout],
  ['gallery', GalleryLayout],
  ['calendar', CalendarLayout],
  ['chart', ChartLayout],
]);

export function drawLayout(layout: Layout, props: LayoutProps): Child {
  return (layouts.get(layout) ?? TableLayout)(props);
}
