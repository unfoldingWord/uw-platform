import type { CollectionRow, RowGroup } from '@uw/contracts';
import { Button } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { fieldControl } from '@uw/ui/components/field.tsx';
import { KanbanCard } from '@uw/ui/components/kanban-card.tsx';
import { Popover } from '@uw/ui/components/menu.tsx';
import { domId } from '@uw/ui/components/text.ts';
import { Lanes } from '@uw/ui/shapes/board.tsx';
import { COLLECTIONS_ENDPOINT } from './collection-edit.tsx';
import { rowFacts, type LayoutProps } from './collection-layouts.tsx';
import { collectionRowPath } from './paths.ts';

const lane = 'flex w-aside shrink-0 flex-col gap-2 rounded-lg bg-raised p-2';

function MoveForm(props: {
  readonly viewId: string;
  readonly row: CollectionRow;
  readonly groups: readonly RowGroup[];
}) {
  const id = domId('move', props.viewId, props.row.id);
  return (
    <PlatformCommandForm
      endpoint={COLLECTIONS_ENDPOINT}
      command="move_card"
      scope={`${props.viewId}-${props.row.id}`}
      done="Moved"
      inline
    >
      <input type="hidden" name="viewId" value={props.viewId} />
      <input type="hidden" name="rowId" value={props.row.id} />
      <label for={id} class="sr-only">{`Move ${props.row.title} to`}</label>
      <select id={id} name="group" class={`min-w-0 flex-1 ${fieldControl}`}>
        {props.groups.map((group) => (
          <option value={group.value} selected={group.value === props.row.group}>
            {group.label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm">
        Move
      </Button>
    </PlatformCommandForm>
  );
}

function MoveAction(props: {
  readonly viewId: string;
  readonly row: CollectionRow;
  readonly groups: readonly RowGroup[];
}) {
  const id = domId('move-to', props.viewId, props.row.id);
  const title = props.row.title === '' ? 'Untitled' : props.row.title;
  return (
    <div class="flex justify-end opacity-0 transition-opacity motion-reveal group-focus-within/card:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100">
      <Button
        size="sm"
        variant="ghost"
        icon="arrows-up-down-left-right"
        label={`Move ${title}`}
        attrs={{ popovertarget: id }}
      >
        Move
      </Button>
      <Popover id={id} label={`Move ${title}`} role="dialog">
        <div class="p-2">
          <MoveForm {...props} />
        </div>
      </Popover>
    </div>
  );
}

function BoardCard(props: {
  readonly layout: LayoutProps;
  readonly row: CollectionRow;
  readonly groups: readonly RowGroup[];
  readonly viewId: string;
}) {
  const { layout, row } = props;
  const writable = layout.mayWrite(row);
  return (
    <KanbanCard
      title={row.title === '' ? 'Untitled' : row.title}
      href={collectionRowPath(layout.definition.key, row.id)}
      meta={[]}
      facts={rowFacts(layout, row)}
      dragRow={writable ? row.id : undefined}
      actions={
        writable ? <MoveAction viewId={props.viewId} row={row} groups={props.groups} /> : undefined
      }
    />
  );
}

function Count(props: { readonly group: RowGroup }) {
  const { count, wipLimit } = props.group;
  const text = wipLimit === null ? String(count) : `${count} of ${wipLimit}`;
  return (
    <p class="m-0 ml-auto font-mono text-xs whitespace-nowrap text-text-3">
      {text}
      <span class="sr-only">{wipLimit === null ? ' rows' : ' rows against the WIP limit'}</span>
    </p>
  );
}

function Column(props: {
  readonly layout: LayoutProps;
  readonly group: RowGroup;
  readonly groups: readonly RowGroup[];
  readonly viewId: string;
}) {
  const { layout, group } = props;
  const headingId = domId('group', props.viewId, group.value);
  const rows = layout.reply.rows.filter((row) => row.group === group.value);
  return (
    <section aria-labelledby={headingId} data-group={group.value} class={lane}>
      <div class="flex items-center gap-2 px-1 pt-1">
        <h2 id={headingId} class="m-0 min-w-0 truncate text-sm font-heavy text-text">
          {group.label}
        </h2>
        <Count group={group} />
      </div>
      <div class="flex flex-col gap-2" data-cards="">
        {rows.map((row) => (
          <BoardCard layout={layout} row={row} groups={props.groups} viewId={props.viewId} />
        ))}
        {rows.length === 0 ? (
          <p class="m-0 rounded-md border border-dashed border-line px-3 py-3 text-center text-sm text-text-3">
            No rows
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function BoardLayout(props: LayoutProps) {
  const viewId = props.reply.view?.id ?? '';
  const groups = (props.reply.groups ?? []).filter((group) => group.visible);
  return (
    <div data-board={viewId} class="flex min-w-0 flex-col gap-2">
      <p data-board-outcome role="status" aria-live="polite" class="m-0 text-sm text-text-3"></p>
      <Lanes label={`${props.definition.name} board`}>
        {groups.map((group) => (
          <Column layout={props} group={group} groups={groups} viewId={viewId} />
        ))}
      </Lanes>
    </div>
  );
}
