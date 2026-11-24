export type Status = {
  readonly loaded: string;
  readonly agents: number;
  readonly gatesOpen: number;
  readonly queue: boolean;
  readonly live: boolean;
  readonly databaseMs: number | null;
  readonly commit: string;
  readonly environment: string;
};

const statusId = 'status-facts';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function Switch(props: { readonly on: boolean; readonly words: string }) {
  return (
    <li class={props.on ? 'text-text-2' : undefined}>
      {props.words} {props.on ? 'on' : 'off'}
    </li>
  );
}

export function StatusDot(props: { readonly status: Status }) {
  const { status } = props;
  return (
    <>
      <button
        type="button"
        popovertarget={statusId}
        title="System status"
        class="grid size-size-5 cursor-pointer place-items-center rounded-md border-0 bg-transparent outline-offset-2 outline-accent-text transition-colors motion-reveal hover:bg-hover focus-visible:outline-2"
      >
        <span aria-hidden="true" class="size-2 rounded-full bg-ok"></span>
        <span class="sr-only">System status</span>
      </button>
      <footer
        id={statusId}
        popover="auto"
        data-chrome=""
        data-anchored=""
        aria-label="Status"
        class="m-0 w-aside max-w-full rounded-lg border-0 bg-surface p-3 text-text shadow-3"
      >
        <p class="m-0 mb-2 flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" class="size-2 rounded-full bg-ok"></span>
          Loaded {status.loaded}
        </p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0 font-mono text-xs text-text-3">
          <li>{plural(status.agents, 'agent', 'agents')}</li>
          <li>{plural(status.gatesOpen, 'gate open', 'gates open')}</li>
          <Switch on={status.queue} words="queue" />
          <Switch on={status.live} words="live updates" />
          <li>{status.databaseMs === null ? 'db not measured' : `db ${status.databaseMs} ms`}</li>
          <li>{status.commit.slice(0, 7)}</li>
          <li>{status.environment}</li>
        </ul>
      </footer>
    </>
  );
}
